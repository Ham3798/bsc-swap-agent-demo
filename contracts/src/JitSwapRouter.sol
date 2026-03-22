// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
}

contract JitSwapRouter {
    struct CandidateCall {
        address target;
        uint256 value;
        bytes data;
    }

    error DeadlineExpired();
    error NoCandidateSucceeded();
    error InsufficientOutput(uint256 received, uint256 minOut);
    error InvalidTarget();
    error InvalidValue();

    event CandidateFailed(uint256 indexed index, address indexed target, bytes reason);
    event CandidateSelected(uint256 indexed index, address indexed target, uint256 receivedAmount);

    function execute(
        CandidateCall[] calldata candidates,
        address tokenOut,
        uint256 minOut,
        uint256 deadline,
        address recipient
    ) external payable returns (uint256 selectedIndex, uint256 receivedAmount) {
        if (block.timestamp > deadline) revert DeadlineExpired();

        uint256 beforeBalance = _balanceOf(tokenOut, recipient);

        for (uint256 i = 0; i < candidates.length; i++) {
            CandidateCall calldata candidate = candidates[i];
            if (candidate.target == address(0)) revert InvalidTarget();
            if (candidate.value > address(this).balance) revert InvalidValue();

            (bool ok, bytes memory returnData) = candidate.target.call{value: candidate.value}(candidate.data);
            if (!ok) {
                emit CandidateFailed(i, candidate.target, returnData);
                continue;
            }

            uint256 afterBalance = _balanceOf(tokenOut, recipient);
            uint256 delta = afterBalance - beforeBalance;
            if (delta < minOut) {
                _emitInsufficientOutput(i, candidate.target, delta, minOut);
                continue;
            }

            emit CandidateSelected(i, candidate.target, delta);
            return (i, delta);
        }

        revert NoCandidateSucceeded();
    }

    function _balanceOf(address token, address recipient) private view returns (uint256) {
        if (token == address(0)) {
            return recipient.balance;
        }
        return IERC20Minimal(token).balanceOf(recipient);
    }

    function _emitInsufficientOutput(uint256 index, address target, uint256 received, uint256 minOut) private {
        emit CandidateFailed(index, target, abi.encodeWithSelector(InsufficientOutput.selector, received, minOut));
    }

    receive() external payable {}
}
