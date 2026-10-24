// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {GameUSDC} from "../src/GameUSDC.sol";
import {USDCFaucet} from "../src/USDCFaucet.sol";
import {GameVault} from "../src/GameVault.sol";
import {RoomManager} from "../src/RoomManager.sol";

/// @dev Deploys the full system behind UUPS proxies (same wiring as script/Deploy.s.sol).
abstract contract Fixture is Test {
    uint256 internal constant USDC = 1e6;
    uint256 internal constant CLAIM = 100 * USDC;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    uint256 internal signerKey = 0xB0B;
    address internal signer;

    GameUSDC internal token;
    USDCFaucet internal faucet;
    GameVault internal vault;
    RoomManager internal rooms;

    function setUp() public virtual {
        signer = vm.addr(signerKey);
        vm.startPrank(owner);
        token = GameUSDC(_proxy(address(new GameUSDC()), abi.encodeCall(GameUSDC.initialize, (owner))));
        faucet = USDCFaucet(
            _proxy(address(new USDCFaucet()), abi.encodeCall(USDCFaucet.initialize, (owner, address(token), CLAIM)))
        );
        vault =
            GameVault(_proxy(address(new GameVault()), abi.encodeCall(GameVault.initialize, (owner, address(token)))));
        rooms = RoomManager(
            _proxy(
                address(new RoomManager()),
                abi.encodeCall(RoomManager.initialize, (owner, address(vault), signer, operator, 0))
            )
        );
        token.setMinter(address(faucet), true);
        vault.setRoomManager(address(rooms));
        vm.stopPrank();
    }

    function _proxy(address impl, bytes memory init) internal returns (address) {
        return address(new ERC1967Proxy(impl, init));
    }

    /// @dev Claim from the faucet and deposit `amount` into the vault.
    function _fund(address player, uint256 amount) internal {
        vm.startPrank(player);
        while (token.balanceOf(player) < amount) faucet.claim();
        token.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }

    function _sign(bytes32 digest) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _join(address player, bytes32 roomId, uint256 bid, uint8 maxPlayers) internal {
        _joinExpect(player, roomId, bid, maxPlayers, "");
    }

    /// @dev Join with a valid backend ticket; when `err` is set, expect exactly that revert.
    ///      The signature is computed first so expectRevert/prank apply to joinRoom itself.
    function _joinExpect(address player, bytes32 roomId, uint256 bid, uint8 maxPlayers, bytes memory err) internal {
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _sign(rooms.hashJoinTicket(roomId, player, bid, maxPlayers, deadline));
        if (err.length > 0) vm.expectRevert(err);
        vm.prank(player);
        rooms.joinRoom(roomId, bid, maxPlayers, deadline, sig);
    }

    function _settle(bytes32 roomId, address[] memory winners, uint256[] memory fees) internal {
        _settleExpect(address(this), roomId, winners, fees, "");
    }

    /// @dev Submit a backend-signed settlement from `sender`; when `err` is set, expect that revert.
    function _settleExpect(
        address sender,
        bytes32 roomId,
        address[] memory winners,
        uint256[] memory fees,
        bytes memory err
    ) internal {
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _sign(rooms.hashSettlement(roomId, winners, fees, deadline));
        if (err.length > 0) vm.expectRevert(err);
        vm.prank(sender);
        rooms.settleRoom(roomId, winners, fees, deadline, sig);
    }

    /// @dev The vault must always hold exactly what it owes.
    function _assertSolvent() internal view {
        assertEq(
            token.balanceOf(address(vault)),
            vault.totalAvailableBalance() + vault.totalLockedBalance() + vault.treasuryBalance(),
            "vault accounting out of sync with token balance"
        );
    }

    function _addrs(address a) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = a;
    }

    function _addrs(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        r[0] = a;
        r[1] = b;
    }
}
