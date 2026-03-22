// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../src/JitSwapRouterV21.sol";

interface VmV21 {
    function expectRevert(bytes4) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8, bytes32, bytes32);
    function addr(uint256 privateKey) external returns (address);
    function prank(address) external;
}

address constant VM_V21_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));

contract TestTokenV21 {
    string public name = "Test";
    string public symbol = "TEST";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockAdapterRouterV21 {
    TestTokenV21 internal immutable tokenIn;
    TestTokenV21 internal immutable tokenOut;
    uint256 internal immutable multiplierBps;

    constructor(TestTokenV21 _tokenIn, TestTokenV21 _tokenOut, uint256 _multiplierBps) {
        tokenIn = _tokenIn;
        tokenOut = _tokenOut;
        multiplierBps = _multiplierBps;
    }

    function executeExactIn(address recipient, uint256 amountIn) external returns (uint256) {
        tokenIn.transferFrom(msg.sender, address(this), amountIn);
        uint256 amountOut = (amountIn * multiplierBps) / 10_000;
        tokenOut.transfer(recipient, amountOut);
        return amountOut;
    }
}

contract JitSwapRouterV21Test {
    VmV21 internal constant vm = VmV21(VM_V21_ADDRESS);

    uint256 internal constant USER_PRIVATE_KEY = 0xA11CE;
    bytes4 internal constant EXECUTE_EXACT_IN_SELECTOR = bytes4(keccak256("executeExactIn(address,uint256)"));

    JitSwapRouterV21 internal router;
    TestTokenV21 internal tokenIn;
    TestTokenV21 internal tokenOut;
    MockAdapterRouterV21 internal openOcean;
    MockAdapterRouterV21 internal oneInch;
    MockAdapterRouterV21 internal pancake;
    address internal user;
    address internal recipient = address(0xCAFE);

    function setUp() public {
        tokenIn = new TestTokenV21();
        tokenOut = new TestTokenV21();
        openOcean = new MockAdapterRouterV21(tokenIn, tokenOut, 9_900);
        oneInch = new MockAdapterRouterV21(tokenIn, tokenOut, 10_100);
        pancake = new MockAdapterRouterV21(tokenIn, tokenOut, 10_050);
        router = new JitSwapRouterV21(
            address(openOcean),
            address(oneInch),
            address(pancake),
            EXECUTE_EXACT_IN_SELECTOR,
            EXECUTE_EXACT_IN_SELECTOR,
            EXECUTE_EXACT_IN_SELECTOR
        );

        user = vm.addr(USER_PRIVATE_KEY);
        tokenIn.mint(user, 100 ether);
        tokenOut.mint(address(openOcean), 1_000 ether);
        tokenOut.mint(address(oneInch), 1_000 ether);
        tokenOut.mint(address(pancake), 1_000 ether);
    }

    function testSelectsBestOfThreeWithValidSignature() public {
        vm.prank(user);
        tokenIn.approve(address(router), 100 ether);

        JitSwapRouterV21.CandidateCall[] memory candidates = _candidates();
        JitSwapRouterV21.Order memory order = _order(candidateSetHash(candidates), recipient, 10 ether, 9 ether, 0);
        bytes memory signature = _sign(order);

        (uint256 selectedIndex, uint256 receivedAmount) = router.execute(order, candidates, signature);

        assertEq(selectedIndex, 1, "best index");
        assertEq(receivedAmount, 10.1 ether, "best amount");
        assertEq(tokenOut.balanceOf(recipient), 10.1 ether, "recipient out");
        assertEq(tokenIn.balanceOf(user), 90 ether, "exact input spent once");
        assertEq(router.nonces(user), 1, "nonce advanced");
    }

    function testReplayFails() public {
        vm.prank(user);
        tokenIn.approve(address(router), 100 ether);

        JitSwapRouterV21.CandidateCall[] memory candidates = _candidates();
        JitSwapRouterV21.Order memory order = _order(candidateSetHash(candidates), recipient, 10 ether, 9 ether, 0);
        bytes memory signature = _sign(order);

        router.execute(order, candidates, signature);

        vm.expectRevert(JitSwapRouterV21.InvalidNonce.selector);
        router.execute(order, candidates, signature);
    }

    function testInvalidSignatureCannotSpendApprovedVictimFunds() public {
        vm.prank(user);
        tokenIn.approve(address(router), 100 ether);

        JitSwapRouterV21.CandidateCall[] memory candidates = _candidates();
        JitSwapRouterV21.Order memory forgedOrder =
            _order(candidateSetHash(candidates), address(0xBEEF), 10 ether, 9 ether, 0);
        bytes memory badSignature = _signWithKey(forgedOrder, 0xB0B);

        vm.expectRevert(JitSwapRouterV21.InvalidSignature.selector);
        router.execute(forgedOrder, candidates, badSignature);

        assertEq(tokenIn.balanceOf(user), 100 ether, "victim balance unchanged");
        assertEq(tokenOut.balanceOf(address(0xBEEF)), 0, "attacker received nothing");
    }

    function testCandidateSetMismatchFails() public {
        vm.prank(user);
        tokenIn.approve(address(router), 100 ether);

        JitSwapRouterV21.CandidateCall[] memory candidates = _candidates();
        JitSwapRouterV21.Order memory order = _order(bytes32(uint256(1)), recipient, 10 ether, 9 ether, 0);
        bytes memory signature = _sign(order);

        vm.expectRevert(JitSwapRouterV21.CandidateSetHashMismatch.selector);
        router.execute(order, candidates, signature);
    }

    function testInvalidRouterFails() public {
        vm.prank(user);
        tokenIn.approve(address(router), 100 ether);

        JitSwapRouterV21.CandidateCall[] memory candidates = _candidates();
        candidates[0].router = address(0xDEAD);
        JitSwapRouterV21.Order memory order = _order(candidateSetHash(candidates), recipient, 10 ether, 9 ether, 0);
        bytes memory signature = _sign(order);

        vm.expectRevert(JitSwapRouterV21.InvalidRouter.selector);
        router.execute(order, candidates, signature);
    }

    function testMaxBlockExpiredFails() public {
        vm.prank(user);
        tokenIn.approve(address(router), 100 ether);

        JitSwapRouterV21.CandidateCall[] memory candidates = _candidates();
        JitSwapRouterV21.Order memory order = _order(candidateSetHash(candidates), recipient, 10 ether, 9 ether, 0);
        order.maxBlockNumber = block.number - 1;
        bytes memory signature = _sign(order);

        vm.expectRevert(JitSwapRouterV21.MaxBlockNumberExpired.selector);
        router.execute(order, candidates, signature);
    }

    function candidateSetHash(JitSwapRouterV21.CandidateCall[] memory candidates) internal view returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](candidates.length);
        for (uint256 i = 0; i < candidates.length; i++) {
            hashes[i] = keccak256(
                abi.encode(
                    router.CANDIDATE_TYPEHASH(),
                    candidates[i].adapterId,
                    candidates[i].router,
                    keccak256(candidates[i].data),
                    candidates[i].value
                )
            );
        }
        return keccak256(abi.encodePacked(hashes));
    }

    function _order(bytes32 setHash, address recipient_, uint256 amountIn, uint256 minOut, uint256 nonce)
        internal
        view
        returns (JitSwapRouterV21.Order memory)
    {
        return JitSwapRouterV21.Order({
            user: user,
            recipient: recipient_,
            tokenIn: address(tokenIn),
            tokenOut: address(tokenOut),
            amountIn: amountIn,
            minOut: minOut,
            maxBlockNumber: block.number + 2,
            nonce: nonce,
            candidateSetHash: setHash
        });
    }

    function _candidates() internal view returns (JitSwapRouterV21.CandidateCall[] memory candidates) {
        candidates = new JitSwapRouterV21.CandidateCall[](3);
        candidates[0] = _candidate(0, address(openOcean));
        candidates[1] = _candidate(1, address(oneInch));
        candidates[2] = _candidate(2, address(pancake));
    }

    function _candidate(uint8 adapterId, address target)
        internal
        view
        returns (JitSwapRouterV21.CandidateCall memory)
    {
        return JitSwapRouterV21.CandidateCall({
            adapterId: adapterId,
            router: target,
            data: abi.encodeCall(MockAdapterRouterV21.executeExactIn, (address(router), 10 ether)),
            value: 0
        });
    }

    function _sign(JitSwapRouterV21.Order memory order) internal returns (bytes memory) {
        return _signWithKey(order, USER_PRIVATE_KEY);
    }

    function _signWithKey(JitSwapRouterV21.Order memory order, uint256 signerKey) internal returns (bytes memory) {
        bytes32 digest = _hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _hashOrder(JitSwapRouterV21.Order memory order) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                router.ORDER_TYPEHASH(),
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
        return keccak256(abi.encodePacked("\x19\x01", router.DOMAIN_SEPARATOR(), structHash));
    }

    function assertEq(uint256 actual, uint256 expected, string memory label) internal pure {
        require(actual == expected, label);
    }
}
