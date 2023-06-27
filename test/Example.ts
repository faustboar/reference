import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, network } from "hardhat";
import ERC20PresetMinterPauserArtifact
  from "@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json";
import ERC721PresetMinterPauserAutoIdArtifact
  from "@openzeppelin/contracts/build/contracts/ERC721PresetMinterPauserAutoId.json";
import { ERC6551Registry, ERC6551AccountUpgradeable, ERC6551AccountProxy } from "../typechain-types";

interface ERC6551Fixture {
  contractOwner: SignerWithAddress
  owners: SignerWithAddress[]
  nftInstances: ERC721PresetMinterPauserAutoId[]
  tokenInstances: ERC20PresetMinterPauser[]
  registry: ERC6551Registry
  implementation: ERC6551AccountUpgradeable
  proxy: ERC6551AccountProxy
  walletInstances: ERC6551AccountUpgradeable[]
}

const chainId = network.config.chainId;

const getCharactersBeforeParenthesis = (input: string): string =>
  input.includes('(') ? input.slice(0, input.indexOf('(')) : '';

function encodeFunctionData(functionSignature: string, args: any[]): string {
  const name = getCharactersBeforeParenthesis(functionSignature);
  const iface = new ethers.utils.Interface(["function " + functionSignature]);
  const data = iface.encodeFunctionData(name, args);
  return data;
}

async function makeERC6551Fixture(): Promise<ERC6551Fixture> {
  const wallets = await ethers.getSigners();
  const ERC20 = await ethers.getContractFactory(ERC20PresetMinterPauserArtifact.abi, ERC20PresetMinterPauserArtifact.bytecode);

  const NFT = await ethers.getContractFactory(ERC721PresetMinterPauserAutoIdArtifact.abi, ERC721PresetMinterPauserAutoIdArtifact.bytecode);
  const nft0 = (await NFT.deploy("NFT", "nft0", "http://")) as ERC721PresetMinterPauserAutoId;
  const nft1 = (await NFT.deploy("NFT", "nft0", "http://")) as ERC721PresetMinterPauserAutoId;

  const token0 = (await ERC20.deploy("token0", "t0")) as ERC20PresetMinterPauser;
  const token1 = (await ERC20.deploy("token0", "t1")) as ERC20PresetMinterPauser;

  const Registry = await ethers.getContractFactory("ERC6551Registry");
  const registry = await Registry.deploy();
  const registryInstance = await registry.deployed();

  const Implementation = await ethers.getContractFactory("ERC6551AccountUpgradeable");
  const implementation = await Implementation.deploy();
  const implementationInstance = await implementation.deployed();

  const Proxy = await ethers.getContractFactory("ERC6551AccountProxy");
  const proxy = await Proxy.deploy(implementationInstance.address);
  const proxyInstance = await proxy.deployed();

  return {
    contractOwner: wallets[0],
    owners: wallets.slice(1),
    nftInstances: [nft0, nft1],
    tokenInstances: [token0, token1],
    registry: registryInstance,
    implementation: implementationInstance,
    proxy: proxyInstance,
    walletInstances: []
  };
}

describe("Example Use Cases", function () {
  let fixture: ERC6551Fixture;

  beforeEach("Deploy Contracts", async () => {
    fixture = await makeERC6551Fixture();
    // Mint 2 so we can have a tokenId of 1
    await fixture.nftInstances[0].mint(fixture.owners[0].address);
    await fixture.nftInstances[0].mint(fixture.owners[0].address);

    let tokenId = 1;
    let salt = 0;
    // Submit txn to create new account 
    let deployTxn = await fixture.registry.createAccount(
      fixture.proxy.address,
      chainId,
      fixture.nftInstances[0].address,
      tokenId,
      salt,
      []
    );
    // Wait for transaction to be mined
    let deployReceipt = await deployTxn.wait();
    // Get new wallet proxy address from emitted AccountCreated event.
    let proxyAddress = deployReceipt.events[0].args[0];
    // Attach proxy to smart wallet ABI  
    let Wallet = await ethers.getContractFactory("ERC6551AccountUpgradeable");
    let wallet = Wallet.attach(proxyAddress);
    console.log("New smart wallet (proxy) deployed to:" + wallet.address);
    fixture.walletInstances.push(wallet);
  })

  it("Example ERC721 Transfer", async () => {
    // Mint 2 NFTs to account owners EOA
    await fixture.nftInstances[1].mint(fixture.owners[0].address);
    await fixture.nftInstances[1].mint(fixture.owners[0].address);

    let tokenId = 1;
    let salt = 0;

    // Look up the smart-wallet address
    let walletAddress = await fixture.registry.account(
      fixture.proxy.address,
      chainId,
      fixture.nftInstances[0].address,
      tokenId,
      salt
    );

    console.log("--------------------------------------------------------------------");
    console.log("TokenId 0 owner before transfer:" + await fixture.nftInstances[1].ownerOf(0));
    console.log("TokenId 1 owner before transfer:" + await fixture.nftInstances[1].ownerOf(1));
    console.log("--------------------------------------------------------------------");
    console.log("Moving NFTs to smart wallet...");

    // Move the NFTs to the smart wallet
    await fixture.nftInstances[1]
      .connect(fixture.owners[0])
      .transferFrom(fixture.owners[0].address, walletAddress, 0);

    await fixture.nftInstances[1]
      .connect(fixture.owners[0])
      .transferFrom(fixture.owners[0].address, walletAddress, 1);

    console.log("TokenId 0 owner after transfer:" + await fixture.nftInstances[1].ownerOf(0));
    console.log("TokenId 1 owner after transfer:" + await fixture.nftInstances[1].ownerOf(1));
    console.log("--------------------------------------------------------------------");
    console.log("Attempting to move TokenId 0 from an EOA which is not the smart wallet owner...");

    let callData = encodeFunctionData(
      'transferFrom(address,address,uint256)',
      [walletAddress, fixture.owners[0].address, 0]);

    await expect(
      fixture.walletInstances[0]
        .connect(fixture.owners[1])
        .executeCall(fixture.nftInstances[1].address, 0, callData)
    ).to.be.revertedWith("Caller is not owner");

    console.log("TokenId 0 owner after failed transfer:" + await fixture.nftInstances[1].ownerOf(0));
    console.log("TokenId 1 owner after failed transfer:" + await fixture.nftInstances[1].ownerOf(1));
    console.log("--------------------------------------------------------------------");
    console.log("Moving TokenId 0 back using transferFrom on the NFT through the smart wallet...");

    await fixture.walletInstances[0]
      .connect(fixture.owners[0])
      .executeCall(fixture.nftInstances[1].address, 0, callData);

    console.log("TokenId 0 owner after first successful transfer:" + await fixture.nftInstances[1].ownerOf(0));
    console.log("TokenId 1 owner after first successful transfer:" + await fixture.nftInstances[1].ownerOf(1));
    console.log("--------------------------------------------------------------------");

    console.log("Moving TokenId 1 back using setApprovalForAll and an EOA initiated transfer...");

    callData = encodeFunctionData(
      'setApprovalForAll(address,bool)',
      [await fixture.walletInstances[0].owner(), true]);
    
    await fixture.walletInstances[0]
      .connect(fixture.owners[0])
      .executeCall(fixture.nftInstances[1].address, 0, callData);

    await fixture.nftInstances[1]
      .connect(fixture.owners[0])
      .transferFrom(fixture.walletInstances[0].address, fixture.owners[0].address, 1);

    console.log("TokenId 0 owner after second successful transfer:" + await fixture.nftInstances[1].ownerOf(0));
    console.log("TokenId 1 owner after second successful transfer:" + await fixture.nftInstances[1].ownerOf(1));
    console.log("--------------------------------------------------------------------");
  });
  
  it("Example ERC20 Transfer", async () => {
    // Mint some ERC20 tokens to account owners EOA
    await fixture.tokenInstances[0].mint(fixture.owners[0].address, 100);
  
    const walletAddress = await fixture.walletInstances[0].address;
  
    console.log("--------------------------------------------------------------------");
    console.log("Balance of Owner 0 before transfer:     ", await fixture.tokenInstances[0].balanceOf(fixture.owners[0].address));
    console.log("Balance of Smart Wallet before transfer:", await fixture.tokenInstances[0].balanceOf(walletAddress));
    console.log("--------------------------------------------------------------------");
    console.log("Transferring ERC20 tokens to smart wallet...");
  
    let transferAmount = 50;
  
    await fixture.tokenInstances[0]
      .connect(fixture.owners[0])
      .transfer(walletAddress, transferAmount);
  
    console.log("Balance of Owner 0 after transfer:     ", await fixture.tokenInstances[0].balanceOf(fixture.owners[0].address));
    console.log("Balance of Smart Wallet after transfer:", await fixture.tokenInstances[0].balanceOf(walletAddress));
    console.log("--------------------------------------------------------------------");
    console.log("Attempting to transfer ERC20 tokens from an EOA which is not the smart wallet owner...");
  
    let callData = encodeFunctionData(
      "transfer(address,uint256)",
      [fixture.owners[0].address, transferAmount]
    );
  
    await expect(
      fixture.walletInstances[0]
        .connect(fixture.owners[1])
        .executeCall(fixture.tokenInstances[0].address, 0, callData)
    ).to.be.revertedWith("Caller is not owner");
  
    console.log("Balance of Owner 0 after failed transfer:     ", await fixture.tokenInstances[0].balanceOf(fixture.owners[0].address));
    console.log("Balance of Smart Wallet after failed transfer:", await fixture.tokenInstances[0].balanceOf(walletAddress));
    console.log("--------------------------------------------------------------------");
    console.log("Transferring ERC20 tokens back to owner 0 using transfer on the ERC20 contract...");
  
    await fixture.walletInstances[0]
      .connect(fixture.owners[0])
      .executeCall(fixture.tokenInstances[0].address, 0, callData);
  
    console.log("Balance of Owner 0 after successful transfer:     ", await fixture.tokenInstances[0].balanceOf(fixture.owners[0].address));
    console.log("Balance of Smart Wallet after successful transfer:", await fixture.tokenInstances[0].balanceOf(walletAddress));
    console.log("--------------------------------------------------------------------");
  });

  it("Example Ether/MATIC Transfer", async () => {
    console.log("--------------------------------------------------------------------");
    console.log("Balance of Owner 0 before transfer:     ", (await ethers.provider.getBalance(fixture.owners[0].address)).toString());
    console.log("Balance of Smart Wallet before transfer:", (await ethers.provider.getBalance(fixture.walletInstances[0].address)).toString());
    console.log("--------------------------------------------------------------------");
    console.log("Transferring Ether to smart wallet...");

    let transferAmount = ethers.utils.parseEther("0.5");

    await fixture.owners[0].sendTransaction({
      to: fixture.walletInstances[0].address,
      value: transferAmount,
    });

    console.log("Balance of Owner 0 after transfer:     ", (await ethers.provider.getBalance(fixture.owners[0].address)).toString());
    console.log("Balance of Smart Wallet after transfer:", (await ethers.provider.getBalance(fixture.walletInstances[0].address)).toString());
    console.log("--------------------------------------------------------------------");
    console.log("Attempting to transfer Ether from an EOA which is not the smart wallet owner...");

    await expect(
      fixture.walletInstances[0]
        .connect(fixture.owners[1])
        .executeCall(fixture.owners[0].address, transferAmount, "0x")
    ).to.be.revertedWith("Caller is not owner");

    console.log("Balance of Owner 0 after failed transfer:     ", (await ethers.provider.getBalance(fixture.owners[0].address)).toString());
    console.log("Balance of Smart Wallet after failed transfer:", (await ethers.provider.getBalance(fixture.walletInstances[0].address)).toString());
    console.log("--------------------------------------------------------------------");
    console.log("Transferring Ether back to owner 0 from the smart wallet owner...");

    await fixture.walletInstances[0]
      .connect(fixture.owners[0])
      .executeCall(fixture.owners[0].address, transferAmount, "0x");

    console.log("Balance of Owner 0 after successful transfer:     ", (await ethers.provider.getBalance(fixture.owners[0].address)).toString());
    console.log("Balance of Smart Wallet after successful transfer:", (await ethers.provider.getBalance(fixture.walletInstances[0].address)).toString());
    console.log("--------------------------------------------------------------------");
  });

  it("Example Account Transfer", async () => {
    console.log("--------------------------------------------------------------------");
    console.log("Transferring Ether to smart wallet...");
    
    let transferAmount = ethers.utils.parseEther("0.5");

    await fixture.owners[0].sendTransaction({
      to: fixture.walletInstances[0].address,
      value: transferAmount,
    });

    console.log("Current Smart Wallet token owner:        ", await fixture.nftInstances[0].ownerOf(1));
    console.log("Current Smart Wallet owner (from wallet):", await fixture.walletInstances[0].owner());
    console.log("Balance of Smart Wallet after transfer:  ", (await ethers.provider.getBalance(fixture.walletInstances[0].address)).toString());
    console.log("--------------------------------------------------------------------");
    console.log("Attempting to transfer Ether from an EOA which is not the smart wallet owner...");

    await expect(
      fixture.walletInstances[0]
        .connect(fixture.owners[1])
        .executeCall(fixture.owners[0].address, transferAmount, "0x")
    ).to.be.revertedWith("Caller is not owner");

    console.log("Balance of Smart Wallet after failed transfer:", (await ethers.provider.getBalance(fixture.walletInstances[0].address)).toString());
    console.log("--------------------------------------------------------------------");
    console.log("Moving ownership NFT of Smart Wallet to the non-owner...");

    await fixture.nftInstances[0]
      .connect(fixture.owners[0])
      .transferFrom(fixture.owners[0].address, fixture.owners[1].address, 1);

    console.log("Current Smart Wallet token owner:        ", await fixture.nftInstances[0].ownerOf(1));
    console.log("Current Smart Wallet owner (from wallet):", await fixture.walletInstances[0].owner());
    console.log("Balance of Smart Wallet after transfer:  ", (await ethers.provider.getBalance(fixture.walletInstances[0].address)).toString());
    console.log("--------------------------------------------------------------------");
    console.log("Attempting to transfer the Ether from the new smart wallet owner...");

    fixture.walletInstances[0]
      .connect(fixture.owners[1])
      .executeCall(fixture.owners[0].address, transferAmount, "0x")
      
    console.log("Current Smart Wallet token owner:        ", await fixture.nftInstances[0].ownerOf(1));
    console.log("Current Smart Wallet owner (from wallet):", await fixture.walletInstances[0].owner());
    console.log("Balance of Smart Wallet after transfer:  ", (await ethers.provider.getBalance(fixture.walletInstances[0].address)).toString());
    console.log("--------------------------------------------------------------------");
    console.log("Attempting to transfer the remaining Ether from the old smart wallet owner...");

    await expect(
      fixture.walletInstances[0]
        .connect(fixture.owners[0])
        .executeCall(fixture.owners[0].address, transferAmount, "0x")
    ).to.be.revertedWith("Caller is not owner");

    console.log("Current Smart Wallet token owner:             ", await fixture.nftInstances[0].ownerOf(1));
    console.log("Current Smart Wallet owner (from wallet):     ", await fixture.walletInstances[0].owner());
    console.log("Balance of Smart Wallet after failed transfer:", (await ethers.provider.getBalance(fixture.walletInstances[0].address)).toString());
    console.log("--------------------------------------------------------------------");
  });

  it("Example Account Upgrade", async () => {
  });
});