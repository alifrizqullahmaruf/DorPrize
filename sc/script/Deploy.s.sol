// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {GameUSDC} from "../src/GameUSDC.sol";
import {USDCFaucet} from "../src/USDCFaucet.sol";
import {GameVault} from "../src/GameVault.sol";
import {RoomManager} from "../src/RoomManager.sol";

/// @notice Deploys GameUSDC, USDCFaucet, GameVault and RoomManager behind UUPS proxies,
///         wires their roles and writes the proxy addresses to deployments/<chainId>.json.
///
/// Signing: pass an encrypted keystore account (`--account deployer --sender <address>`, set up
/// once with `cast wallet import deployer --interactive`). No private key is read from a file.
/// On a local anvil chain (31337) the well-known dev account is used instead.
///
/// Env: INITIAL_OWNER, BACKEND_SIGNER, OPERATOR (all default to the deployer),
///      USDC_FAUCET_CLAIM_AMOUNT, REFUND_DELAY.
contract Deploy is Script {
    uint256 internal constant DEFAULT_CLAIM_AMOUNT = 100 * 1e6;
    uint64 internal constant DEFAULT_REFUND_DELAY = 1 hours;
    /// @dev anvil's well-known first dev account; only ever used on chain id 31337.
    uint256 internal constant ANVIL_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    struct Deployment {
        address usdc;
        address faucet;
        address vault;
        address roomManager;
    }

    function run() external returns (Deployment memory d) {
        bool local = block.chainid == 31337;
        // With --account/--sender, msg.sender is the keystore account that will sign.
        address deployer = local ? vm.addr(ANVIL_KEY) : msg.sender;
        require(deployer != DEFAULT_SENDER, "Pass --account <keystore name> (cast wallet import)");
        address owner = vm.envOr("INITIAL_OWNER", deployer);
        address signer = vm.envOr("BACKEND_SIGNER", deployer);
        address operator = vm.envOr("OPERATOR", deployer);
        uint256 claimAmount = vm.envOr("USDC_FAUCET_CLAIM_AMOUNT", DEFAULT_CLAIM_AMOUNT);
        uint64 refundDelay = uint64(vm.envOr("REFUND_DELAY", uint256(DEFAULT_REFUND_DELAY)));

        if (local) vm.startBroadcast(ANVIL_KEY);
        else vm.startBroadcast(deployer);

        // The deployer owns everything until wiring is done, then ownership moves to `owner`.
        GameUSDC token = GameUSDC(_proxy(address(new GameUSDC()), abi.encodeCall(GameUSDC.initialize, (deployer))));
        USDCFaucet faucet = USDCFaucet(
            _proxy(
                address(new USDCFaucet()), abi.encodeCall(USDCFaucet.initialize, (owner, address(token), claimAmount))
            )
        );
        GameVault vault = GameVault(
            _proxy(address(new GameVault()), abi.encodeCall(GameVault.initialize, (deployer, address(token))))
        );
        RoomManager rooms = RoomManager(
            _proxy(
                address(new RoomManager()),
                abi.encodeCall(RoomManager.initialize, (owner, address(vault), signer, operator, refundDelay))
            )
        );

        token.setMinter(address(faucet), true);
        vault.setRoomManager(address(rooms));
        if (owner != deployer) {
            token.transferOwnership(owner);
            vault.transferOwnership(owner);
        }

        vm.stopBroadcast();

        d = Deployment({
            usdc: address(token), faucet: address(faucet), vault: address(vault), roomManager: address(rooms)
        });
        _write(d, owner, signer, operator);

        console2.log("chain id      ", block.chainid);
        console2.log("GameUSDC      ", d.usdc);
        console2.log("USDCFaucet    ", d.faucet);
        console2.log("GameVault     ", d.vault);
        console2.log("RoomManager   ", d.roomManager);
        console2.log("owner         ", owner);
        console2.log("backendSigner ", signer);
        console2.log("operator      ", operator);
    }

    function _proxy(address impl, bytes memory init) internal returns (address) {
        return address(new ERC1967Proxy(impl, init));
    }

    function _write(Deployment memory d, address owner, address signer, address operator) internal {
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "GameUSDC", d.usdc);
        vm.serializeAddress(obj, "USDCFaucet", d.faucet);
        vm.serializeAddress(obj, "GameVault", d.vault);
        vm.serializeAddress(obj, "RoomManager", d.roomManager);
        vm.serializeAddress(obj, "owner", owner);
        vm.serializeAddress(obj, "backendSigner", signer);
        string memory json = vm.serializeAddress(obj, "operator", operator);
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }
}
