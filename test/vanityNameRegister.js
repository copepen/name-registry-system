const { ethers } = require("hardhat");
const { expect } = require("chai");
const { constants, BigNumber, utils } = require("ethers");
const { time } = require("@openzeppelin/test-helpers");

describe("VanityNameRegister contract test:", () => {
  const initialSupply = utils.parseEther("1000000");

  let mockERC20;
  let hardhatMockERC20;

  let nameRegister;
  let hardhatNameRegister;

  // accounts
  let account1;
  let account2;
  let treasury;

  // hashes
  let hash1;
  let hash2;
  let name1;
  let name2;
  let salt;

  // const params
  let commitRevealPendingPeriod;
  let lockPeriod;
  let lockAmount;

  beforeEach(async () => {
    [deployer, account1, account2, treasury] = await ethers.getSigners();

    // mock ERC20 token prepare
    mockERC20 = await ethers.getContractFactory("MockERC20");
    hardhatMockERC20 = await mockERC20.deploy(
      "mock Test Token",
      "mTTK",
      initialSupply.toString()
    );

    // VanityNameRegister Contract prepare
    nameRegister = await ethers.getContractFactory("VanityNameRegister");
    const lockToken = hardhatMockERC20.address;
    const treasuryAddress = treasury.address;
    const feeMultiplier = BigNumber.from(5);

    hardhatNameRegister = await nameRegister.deploy(
      lockToken,
      treasuryAddress,
      feeMultiplier.toString()
    );

    // charge lock token to test accounts (account1 and account2)
    await hardhatMockERC20
      .connect(deployer)
      .transfer(account1.address, utils.parseEther("10000"));
    await hardhatMockERC20
      .connect(deployer)
      .transfer(account2.address, utils.parseEther("10000"));

    // approve
    await hardhatMockERC20
      .connect(account1)
      .approve(hardhatNameRegister.address, constants.MaxUint256);
    await hardhatMockERC20
      .connect(account2)
      .approve(hardhatNameRegister.address, constants.MaxUint256);

    // hashes
    name1 = "ADVANCED";
    name2 = "BLOCKCHAIN";
    salt = "SALT_KEY";

    hash1 = ethers.utils.solidityKeccak256(
      ["address", "string", "string"],
      [account1.address, name1, salt]
    );
    hash2 = ethers.utils.solidityKeccak256(
      ["address", "string", "string"],
      [account2.address, name2, salt]
    );

    commitRevealPendingPeriod =
      await hardhatNameRegister.COMMIT_REVEAL_PENDING_PERIOD();
    lockPeriod = await hardhatNameRegister.LOCK_PERIOD();
    lockAmount = await hardhatNameRegister.LOCK_AMOUNT();
  });

  describe("constant param test", () => {
    it("should be same with values from contract", async () => {
      expect(commitRevealPendingPeriod).to.be.equal("10");
      expect(lockPeriod).to.be.equal("18000");
      expect(lockAmount).to.be.equal("5000000000000000000");

      expect(
        (await hardhatNameRegister.feeMultiplier()).toString()
      ).to.be.equal("5");
      expect(await hardhatNameRegister.lockToken()).to.be.equal(
        hardhatMockERC20.address
      );
      expect(await hardhatNameRegister.treasury()).to.be.equal(
        treasury.address
      );
    });
  });

  describe("preRegister function test", () => {
    it("should be succeeded at first time", async () => {
      await hardhatNameRegister.connect(account1).preRegister(hash1);

      const nameCommitTimestamp = await hardhatNameRegister.nameCommits(hash1);
      expect(nameCommitTimestamp.toNumber()).to.be.gte(0);
    });

    it("should be able to pre-register with different 2 hashes", async () => {
      await hardhatNameRegister.connect(account1).preRegister(hash1);
      await hardhatNameRegister.connect(account1).preRegister(hash2);

      const nameCommitTimestamp = await hardhatNameRegister.nameCommits(hash2);
      expect(nameCommitTimestamp.toNumber()).to.be.gte(0);
    });

    it("should be failed with same hash", async () => {
      await hardhatNameRegister.connect(account1).preRegister(hash1);
      await expect(
        hardhatNameRegister.connect(account1).preRegister(hash1)
      ).to.be.revertedWith("Hash already committed");
    });

    it("should be failed with registered user", async () => {
      await hardhatNameRegister.connect(account1).preRegister(hash1);
      await time.increase(commitRevealPendingPeriod.toNumber());

      const fee = await hardhatNameRegister.calculateFee(name1);
      await hardhatNameRegister
        .connect(account1)
        .register(hash1, name1, salt, { value: fee });

      await expect(
        hardhatNameRegister.connect(account1).preRegister(hash1)
      ).to.be.revertedWith("User already registered");
    });
  });

  describe("register function test", () => {
    it("should be failed with empty name", async () => {
      await expect(
        hardhatNameRegister.connect(account1).register(hash1, "", salt)
      ).to.be.revertedWith("Name can't be empty");
    });

    it("should be failed if pre-register was not done", async () => {
      await expect(
        hardhatNameRegister.connect(account1).register(hash1, name1, salt)
      ).to.be.revertedWith("Hash not yet committed");
    });

    it("should be failed in COMMIT_REVEAL_PENDING_PERIOD", async () => {
      await hardhatNameRegister.connect(account1).preRegister(hash1);
      await expect(
        hardhatNameRegister.connect(account1).register(hash1, name1, salt)
      ).to.be.revertedWith(
        "Registration can be only completed after certain time"
      );
    });

    it("should be failed with incorrect name", async () => {
      await hardhatNameRegister.connect(account1).preRegister(hash1);
      await time.increase(commitRevealPendingPeriod.toNumber());

      await expect(
        hardhatNameRegister.connect(account1).register(hash1, name2, salt)
      ).to.be.revertedWith("Commit not matched");
    });

    it("should be failed without fee", async () => {
      await hardhatNameRegister.connect(account1).preRegister(hash1);
      await time.increase(commitRevealPendingPeriod.toNumber());

      await expect(
        hardhatNameRegister.connect(account1).register(hash1, name1, salt)
      ).to.be.revertedWith("Insufficient eth");
    });

    it("should be succeeded", async () => {
      await hardhatNameRegister.connect(account1).preRegister(hash1);
      await time.increase(commitRevealPendingPeriod.toNumber());

      // before
      const treasuryEthBalBefore = await treasury.getBalance();
      const account1LockTokenBalBefore = await hardhatMockERC20.balanceOf(
        account1.address
      );

      const fee = await hardhatNameRegister.calculateFee(name1);
      const lockAmount = await hardhatNameRegister.LOCK_AMOUNT();
      await hardhatNameRegister
        .connect(account1)
        .register(hash1, name1, salt, { value: fee });

      // after
      const nameCommitTimestampAfter = await hardhatNameRegister.nameCommits(
        hash1
      );
      const treasuryEthBalAfter = await treasury.getBalance();
      const account1LockTokenBalAfter = await hardhatMockERC20.balanceOf(
        account1.address
      );
      const userInfoAfter = await hardhatNameRegister.userInfo(
        account1.address
      );
      const nameInfoAfter = await hardhatNameRegister.nameInfo(name1);

      expect(nameCommitTimestampAfter.toNumber()).to.be.equal(0);

      expect(nameInfoAfter.owner).to.be.equal(account1.address);
      expect(nameInfoAfter.registered).to.be.equal(true);
      expect(nameInfoAfter.registeredTimestamp.toNumber()).to.be.gte(0);

      expect(userInfoAfter.name).to.be.equal(name1);
      expect(userInfoAfter.lockedBalance.toString()).to.be.equal(
        lockAmount.toString()
      );
      expect(userInfoAfter.registeredTimestamp.toNumber()).to.be.gte(0);

      expect(treasuryEthBalAfter.toString()).to.be.equal(
        treasuryEthBalBefore.add(fee).toString()
      );
      expect(account1LockTokenBalAfter.add(lockAmount).toString()).to.be.equal(
        account1LockTokenBalBefore.toString()
      );
    });
  });

  describe("withdraw function test", () => {
    it("should be failed in lock period", async () => {
      await hardhatNameRegister.connect(account1).preRegister(hash1);
      await time.increase(commitRevealPendingPeriod.toNumber());

      const fee = await hardhatNameRegister.calculateFee(name1);
      await hardhatNameRegister
        .connect(account1)
        .register(hash1, name1, salt, { value: fee });

      await expect(
        hardhatNameRegister.connect(account1).withdraw()
      ).to.be.revertedWith(`Can't withdraw in lock period`);
    });

    it("should be succeed after lock period", async () => {
      await hardhatNameRegister.connect(account1).preRegister(hash1);
      await time.increase(commitRevealPendingPeriod.toNumber());

      const fee = await hardhatNameRegister.calculateFee(name1);
      await hardhatNameRegister
        .connect(account1)
        .register(hash1, name1, salt, { value: fee });

      await time.increase(lockPeriod.toNumber());

      const account1LockTokenBalBefore = await hardhatMockERC20.balanceOf(
        account1.address
      );

      await hardhatNameRegister.connect(account1).withdraw();
      const account1LockTokenBalAfter = await hardhatMockERC20.balanceOf(
        account1.address
      );

      expect(account1LockTokenBalBefore.add(lockAmount).toString()).to.be.equal(
        account1LockTokenBalAfter.toString()
      );
    });
  });

  describe("renew function test", () => {
    it("should be failed with empty name", async () => {
      await expect(
        hardhatNameRegister.connect(account1).renew("")
      ).to.be.revertedWith(`Name can't be empty`);
    });

    it("should be failed with different name", async () => {
      await hardhatNameRegister.connect(account1).preRegister(hash1);
      await time.increase(commitRevealPendingPeriod.toNumber());

      const fee = await hardhatNameRegister.calculateFee(name1);
      await hardhatNameRegister
        .connect(account1)
        .register(hash1, name1, salt, { value: fee });

      await expect(
        hardhatNameRegister.connect(account1).renew(name2)
      ).to.be.revertedWith("Name is not matched");
    });

    it("should be succeeded with same name", async () => {
      await hardhatNameRegister.connect(account1).preRegister(hash1);
      await time.increase(commitRevealPendingPeriod.toNumber());

      const fee = await hardhatNameRegister.calculateFee(name1);
      await hardhatNameRegister
        .connect(account1)
        .register(hash1, name1, salt, { value: fee });

      // before
      const userInfoBefore = await hardhatNameRegister.userInfo(
        account1.address
      );
      const nameInfoBefore = await hardhatNameRegister.nameInfo(name1);

      await time.increase(lockPeriod.toNumber());
      await hardhatNameRegister.connect(account1).renew(name1, { value: fee });

      // after
      const userInfoAfter = await hardhatNameRegister.userInfo(
        account1.address
      );
      const nameInfoAfter = await hardhatNameRegister.nameInfo(name1);

      expect(userInfoBefore.registeredTimestamp.toNumber()).to.be.not.equal(
        userInfoAfter.registeredTimestamp.toNumber()
      );
      expect(nameInfoBefore.registeredTimestamp.toNumber()).to.be.not.equal(
        nameInfoAfter.registeredTimestamp.toNumber()
      );
    });
  });
});
