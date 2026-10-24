// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Fixture} from "./Fixture.sol";
import {GameVault} from "../src/GameVault.sol";
import {USDCFaucet} from "../src/USDCFaucet.sol";

contract GameVaultTest is Fixture {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    bytes32 internal constant ROOM = keccak256("ROOM1");

    function test_FaucetMintsClaimAmount() public {
        vm.prank(alice);
        faucet.claim();
        assertEq(token.balanceOf(alice), CLAIM);
        assertEq(token.decimals(), 6);
    }

    function test_DepositAndWithdraw() public {
        _fund(alice, 10 * USDC);
        assertEq(vault.availableBalanceOf(alice), 10 * USDC);

        vm.prank(alice);
        vault.withdraw(4 * USDC);
        assertEq(vault.availableBalanceOf(alice), 6 * USDC);
        assertEq(token.balanceOf(alice), CLAIM - 6 * USDC);
        _assertSolvent();
    }

    function test_WithdrawBlockedWhileInActiveRoom() public {
        _fund(alice, 10 * USDC);
        _join(alice, ROOM, 2 * USDC, 4);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(GameVault.WithdrawBlockedActiveRoom.selector, alice, 1));
        vault.withdraw(1 * USDC);

        // Leaving the room unblocks withdrawals.
        vm.prank(alice);
        rooms.leaveRoom(ROOM);
        vm.prank(alice);
        vault.withdraw(10 * USDC);
        assertEq(vault.availableBalanceOf(alice), 0);
        _assertSolvent();
    }

    function test_OnlyRoomManagerMovesBalances() public {
        _fund(alice, 10 * USDC);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(GameVault.UnauthorizedRoomManager.selector, bob));
        vault.lockBid(alice, ROOM, 1 * USDC);
    }

    function test_RescueCannotTouchPlayerFunds() public {
        _fund(alice, 10 * USDC);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(GameVault.InsufficientRescuableBalance.selector, 0, 1));
        vault.rescueToken(address(token), owner, 1);
    }

    function test_FaucetPausable() public {
        vm.prank(owner);
        faucet.pause();
        vm.prank(alice);
        vm.expectRevert();
        faucet.claim();
    }

    function test_OnlyOwnerCanUpgrade() public {
        address impl = address(new USDCFaucet());
        vm.prank(alice);
        vm.expectRevert();
        faucet.upgradeToAndCall(impl, "");
    }
}
