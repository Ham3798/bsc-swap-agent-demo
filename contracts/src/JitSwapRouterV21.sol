// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IERC20MinimalV21 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract JitSwapRouterV21 {
    string public constant NAME = "JitSwapRouterV21";
    string public constant VERSION = "1";

    bytes32 public constant CANDIDATE_TYPEHASH =
        keccak256("CandidateCall(uint8 adapterId,address router,bytes data,uint256 value)");
    bytes32 public constant ORDER_TYPEHASH =
        keccak256(
            "Order(address user,address recipient,address tokenIn,address tokenOut,uint256 amountIn,uint256 minOut,uint256 maxBlockNumber,uint256 nonce,bytes32 candidateSetHash)"
        );
    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    enum AdapterId {
        OpenOceanV2,
        OneInch,
        PancakeSwap
    }

    struct CandidateCall {
        uint8 adapterId;
        address router;
        bytes data;
        uint256 value;
    }

    struct Order {
        address user;
        address recipient;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minOut;
        uint256 maxBlockNumber;
        uint256 nonce;
        bytes32 candidateSetHash;
    }

    struct ExecutionContext {
        address user;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        address recipient;
    }

    error InvalidCandidateCount();
    error InvalidRouter();
    error InvalidAdapter();
    error InvalidValue();
    error InvalidSelector();
    error InvalidSignature();
    error InvalidNonce();
    error CandidateSetHashMismatch();
    error MaxBlockNumberExpired();
    error NoCandidateSucceeded();
    error ProbeOnly();
    error InsufficientOutput(uint256 received, uint256 minOut);
    error ProbeSucceeded(uint256 index, uint256 receivedAmount);

    event CandidateProbed(uint256 indexed index, uint8 indexed adapterId, uint256 receivedAmount);
    event CandidateSelected(uint256 indexed index, uint8 indexed adapterId, uint256 receivedAmount);

    mapping(address => uint256) public nonces;

    address public immutable openOceanRouter;
    address public immutable oneInchRouter;
    address public immutable pancakeRouter;
    bytes4 public immutable openOceanSelector;
    bytes4 public immutable oneInchSelector;
    bytes4 public immutable pancakeSelector;

    modifier onlySelf() {
        if (msg.sender != address(this)) revert ProbeOnly();
        _;
    }

    constructor(
        address openOceanRouter_,
        address oneInchRouter_,
        address pancakeRouter_,
        bytes4 openOceanSelector_,
        bytes4 oneInchSelector_,
        bytes4 pancakeSelector_
    ) {
        openOceanRouter = openOceanRouter_;
        oneInchRouter = oneInchRouter_;
        pancakeRouter = pancakeRouter_;
        openOceanSelector = openOceanSelector_;
        oneInchSelector = oneInchSelector_;
        pancakeSelector = pancakeSelector_;
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    function execute(
        Order calldata order,
        CandidateCall[] calldata candidates,
        bytes calldata signature
    ) external payable returns (uint256 selectedIndex, uint256 receivedAmount) {
        if (block.number > order.maxBlockNumber) revert MaxBlockNumberExpired();
        if (candidates.length != 3) revert InvalidCandidateCount();
        if (order.nonce != nonces[order.user]) revert InvalidNonce();
        if (order.candidateSetHash != hashCandidates(candidates)) revert CandidateSetHashMismatch();
        _verifySignature(order, signature);
        _validateExecuteValue(order);

        nonces[order.user] = order.nonce + 1;

        ExecutionContext memory context = ExecutionContext({
            user: order.user,
            tokenIn: order.tokenIn,
            tokenOut: order.tokenOut,
            amountIn: order.amountIn,
            recipient: order.recipient
        });
        uint256 bestIndex = type(uint256).max;
        uint256 bestReceived = 0;

        for (uint256 i = 0; i < candidates.length; i++) {
            CandidateCall calldata candidate = candidates[i];
            _validateCandidate(candidate);

            try
                this._probeCandidate{value: context.tokenIn == address(0) ? context.amountIn : 0}(
                    i,
                    context,
                    candidate
                )
            {
                revert ProbeOnly();
            } catch (bytes memory reason) {
                if (reason.length >= 4 && bytes4(reason) == ProbeSucceeded.selector) {
                    (uint256 index, uint256 candidateReceived) = _decodeProbeSucceeded(reason);
                    emit CandidateProbed(index, candidate.adapterId, candidateReceived);
                    if (candidateReceived >= order.minOut && candidateReceived > bestReceived) {
                        bestReceived = candidateReceived;
                        bestIndex = index;
                    }
                }
            }
        }

        if (bestIndex == type(uint256).max) revert NoCandidateSucceeded();

        receivedAmount = _runCandidate(context, candidates[bestIndex], false);
        if (receivedAmount < order.minOut) revert InsufficientOutput(receivedAmount, order.minOut);

        emit CandidateSelected(bestIndex, candidates[bestIndex].adapterId, receivedAmount);
        return (bestIndex, receivedAmount);
    }

    function _probeCandidate(
        uint256 index,
        ExecutionContext calldata context,
        CandidateCall calldata candidate
    ) external payable onlySelf returns (uint256) {
        uint256 received = _runCandidate(context, candidate, true);
        revert ProbeSucceeded(index, received);
    }

    function hashCandidates(CandidateCall[] calldata candidates) public pure returns (bytes32) {
        bytes32[] memory candidateHashes = new bytes32[](candidates.length);
        for (uint256 i = 0; i < candidates.length; i++) {
            candidateHashes[i] = keccak256(
                abi.encode(
                    CANDIDATE_TYPEHASH,
                    candidates[i].adapterId,
                    candidates[i].router,
                    keccak256(candidates[i].data),
                    candidates[i].value
                )
            );
        }
        return keccak256(abi.encodePacked(candidateHashes));
    }

    function hashOrder(Order calldata order) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.user,
                order.recipient,
                order.tokenIn,
                order.tokenOut,
                order.amountIn,
                order.minOut,
                order.maxBlockNumber,
                order.nonce,
                order.candidateSetHash
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    function _validateExecuteValue(Order calldata order) internal view {
        if (order.tokenIn == address(0)) {
            if (msg.value != order.amountIn) revert InvalidValue();
            return;
        }
        if (msg.value != 0) revert InvalidValue();
    }

    function _verifySignature(Order calldata order, bytes calldata signature) internal view {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 digest = hashOrder(order);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0) || recovered != order.user) revert InvalidSignature();
    }

    function _runCandidate(
        ExecutionContext memory context,
        CandidateCall calldata candidate,
        bool probeMode
    ) internal returns (uint256 receivedAmount) {
        uint256 beforeBalance = _balanceOf(context.tokenOut, address(this));

        if (context.tokenIn == address(0)) {
            if (candidate.value != context.amountIn) revert InvalidValue();
        } else {
            if (candidate.value != 0) revert InvalidValue();
            _pullToken(context.tokenIn, context.user, context.amountIn);
            _approveExact(context.tokenIn, candidate.router, context.amountIn);
        }

        (bool ok, bytes memory returnData) = candidate.router.call{value: candidate.value}(candidate.data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(returnData, 32), mload(returnData))
            }
        }

        uint256 afterBalance = _balanceOf(context.tokenOut, address(this));
        receivedAmount = afterBalance - beforeBalance;

        if (!probeMode) {
            _distributeOutput(context.tokenOut, context.recipient, receivedAmount);
            if (context.tokenIn != address(0)) {
                _approveExact(context.tokenIn, candidate.router, 0);
            }
        }
    }

    function _validateCandidate(CandidateCall calldata candidate) internal view {
        if (candidate.router == address(0)) revert InvalidRouter();
        if (candidate.adapterId > uint8(AdapterId.PancakeSwap)) revert InvalidAdapter();
        if (candidate.router != _allowedRouter(candidate.adapterId)) revert InvalidRouter();
    }

    function _allowedRouter(uint8 adapterId) internal view returns (address) {
        if (adapterId == uint8(AdapterId.OpenOceanV2)) return openOceanRouter;
        if (adapterId == uint8(AdapterId.OneInch)) return oneInchRouter;
        return pancakeRouter;
    }

    function _decodeProbeSucceeded(bytes memory reason) internal pure returns (uint256 index, uint256 receivedAmount) {
        bytes memory payload = new bytes(reason.length - 4);
        for (uint256 i = 4; i < reason.length; i++) {
            payload[i - 4] = reason[i];
        }
        return abi.decode(payload, (uint256, uint256));
    }

    function _pullToken(address token, address from, uint256 amount) internal {
        bool ok = IERC20MinimalV21(token).transferFrom(from, address(this), amount);
        require(ok, "transferFrom failed");
    }

    function _approveExact(address token, address spender, uint256 amount) internal {
        IERC20MinimalV21 erc20 = IERC20MinimalV21(token);
        uint256 currentAllowance = erc20.allowance(address(this), spender);
        if (currentAllowance != 0) {
            bool cleared = erc20.approve(spender, 0);
            require(cleared, "approve reset failed");
        }
        if (amount == 0) return;
        bool ok = erc20.approve(spender, amount);
        require(ok, "approve failed");
    }

    function _distributeOutput(address tokenOut, address recipient, uint256 amount) internal {
        if (tokenOut == address(0)) {
            (bool ok,) = payable(recipient).call{value: amount}("");
            require(ok, "native transfer failed");
            return;
        }

        bool transferred = IERC20MinimalV21(tokenOut).transfer(recipient, amount);
        require(transferred, "token transfer failed");
    }

    function _balanceOf(address token, address account) internal view returns (uint256) {
        if (token == address(0)) {
            return account.balance;
        }
        return IERC20MinimalV21(token).balanceOf(account);
    }

    receive() external payable {}
}
