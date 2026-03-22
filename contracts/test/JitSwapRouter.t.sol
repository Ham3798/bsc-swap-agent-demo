// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../src/JitSwapRouter.sol";

interface Vm {
    function expectRevert(bytes4) external;
}

address constant VM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));

contract TestToken {
    string public name = "Test";
    string public symbol = "TEST";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract SuccessTarget {
    TestToken internal immutable token;

    constructor(TestToken _token) {
        token = _token;
    }

    function sendTo(address recipient, uint256 amount) external {
        token.transfer(recipient, amount);
    }
}

contract FailTarget {
    function fail() external pure {
        revert("fail");
    }
}

contract ShortTarget {
    TestToken internal immutable token;

    constructor(TestToken _token) {
        token = _token;
    }

    function sendLess(address recipient, uint256 amount) external {
        token.transfer(recipient, amount / 2);
    }
}

contract JitSwapRouterTest {
    Vm internal constant vm = Vm(VM_ADDRESS);
    JitSwapRouter internal router;
    TestToken internal token;
    SuccessTarget internal successTarget;
    FailTarget internal failTarget;
    ShortTarget internal shortTarget;
    address internal recipient = address(0xBEEF);

    function setUp() public {
        router = new JitSwapRouter();
        token = new TestToken();
        successTarget = new SuccessTarget(token);
        failTarget = new FailTarget();
        shortTarget = new ShortTarget(token);

        token.mint(address(successTarget), 1_000 ether);
        token.mint(address(shortTarget), 1_000 ether);
    }

    function testFirstPathSuccess() public {
        JitSwapRouter.CandidateCall[] memory candidates = new JitSwapRouter.CandidateCall[](1);
        candidates[0] = JitSwapRouter.CandidateCall({
            target: address(successTarget),
            value: 0,
            data: abi.encodeCall(SuccessTarget.sendTo, (recipient, 100 ether))
        });

        (uint256 selectedIndex, uint256 receivedAmount) =
            router.execute(candidates, address(token), 90 ether, block.timestamp + 60, recipient);

        assertEq(selectedIndex, 0, "selectedIndex");
        assertEq(receivedAmount, 100 ether, "receivedAmount");
        assertEq(token.balanceOf(recipient), 100 ether, "recipientBalance");
    }

    function testFirstFailSecondSuccess() public {
        JitSwapRouter.CandidateCall[] memory candidates = new JitSwapRouter.CandidateCall[](2);
        candidates[0] = JitSwapRouter.CandidateCall({
            target: address(failTarget),
            value: 0,
            data: abi.encodeCall(FailTarget.fail, ())
        });
        candidates[1] = JitSwapRouter.CandidateCall({
            target: address(successTarget),
            value: 0,
            data: abi.encodeCall(SuccessTarget.sendTo, (recipient, 100 ether))
        });

        (uint256 selectedIndex, uint256 receivedAmount) =
            router.execute(candidates, address(token), 90 ether, block.timestamp + 60, recipient);

        assertEq(selectedIndex, 1, "selectedIndex");
        assertEq(receivedAmount, 100 ether, "receivedAmount");
        assertEq(token.balanceOf(recipient), 100 ether, "recipientBalance");
    }

    function testRevertsWhenAllFail() public {
        JitSwapRouter.CandidateCall[] memory candidates = new JitSwapRouter.CandidateCall[](1);
        candidates[0] = JitSwapRouter.CandidateCall({
            target: address(failTarget),
            value: 0,
            data: abi.encodeCall(FailTarget.fail, ())
        });

        vm.expectRevert(JitSwapRouter.NoCandidateSucceeded.selector);
        router.execute(candidates, address(token), 1, block.timestamp + 60, recipient);
    }

    function testRevertsWhenMinOutNotMet() public {
        JitSwapRouter.CandidateCall[] memory candidates = new JitSwapRouter.CandidateCall[](1);
        candidates[0] = JitSwapRouter.CandidateCall({
            target: address(shortTarget),
            value: 0,
            data: abi.encodeCall(ShortTarget.sendLess, (recipient, 100 ether))
        });

        vm.expectRevert(JitSwapRouter.NoCandidateSucceeded.selector);
        router.execute(candidates, address(token), 90 ether, block.timestamp + 60, recipient);
    }

    function testRevertsWhenDeadlineExpired() public {
        JitSwapRouter.CandidateCall[] memory candidates = new JitSwapRouter.CandidateCall[](1);
        candidates[0] = JitSwapRouter.CandidateCall({
            target: address(successTarget),
            value: 0,
            data: abi.encodeCall(SuccessTarget.sendTo, (recipient, 100 ether))
        });

        vm.expectRevert(JitSwapRouter.DeadlineExpired.selector);
        router.execute(candidates, address(token), 90 ether, block.timestamp - 1, recipient);
    }

    function assertEq(uint256 actual, uint256 expected, string memory label) internal pure {
        require(actual == expected, label);
    }
}
