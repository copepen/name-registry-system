// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "hardhat/console.sol";

contract VanityNameRegister is ReentrancyGuard {
    uint256 public constant COMMIT_REVEAL_PENDING_PERIOD = 10;
    uint256 public constant LOCK_PERIOD = 5 * 60 * 60; // lock period: 5 hrs
    uint256 public constant LOCK_AMOUNT = 5e18; // lock amount

    uint256 public feeMultiplier;
    IERC20 public lockToken;
    address public treasury;

    // Info of user
    struct UserInfo {
        string name;
        uint256 registeredTimestamp;
        uint256 lockedBalance;
    }

    // Info of name
    struct NameInfo {
        address owner;
        uint256 registeredTimestamp;
        bool registered;
    }

    mapping(bytes32 => uint256) public nameCommits;
    mapping(string => NameInfo) public nameInfo;
    mapping(address => UserInfo) public userInfo;

    event PreRegistered(
        address indexed account,
        bytes32 data,
        uint256 timestamp
    );
    event Registered(address indexed account, string name, uint256 timestamp);
    event Renewed(address indexed account, string name, uint256 timestamp);
    event FeeCharged(address indexed account, uint256 amount);

    constructor(
        address _lockToken,
        address _treasury,
        uint256 _feeMultiplier
    ) {
        require(_lockToken != address(0), "LockToken can't be zero");
        require(_treasury != address(0), "Treasury can't be zero");
        require(_feeMultiplier != 0, "Fee per name char can't be 0");

        lockToken = IERC20(_lockToken);
        treasury = _treasury;
        feeMultiplier = _feeMultiplier;
    }

    /**
     * @notice transfer eth
     * @param _to     receipnt address
     * @param _value  amount
     */
    function _safeTransferETH(address _to, uint256 _value) internal {
        (bool success, ) = payable(_to).call{value: _value}(new bytes(0));
        require(success, "SafeTransferETH: ETH transfer failed");
    }

    /**
     * @notice charge fee
     * @param _name     user name
     */
    function _chargeFee(string memory _name) internal {
        uint256 fee = calculateFee(_name);
        require(msg.value >= fee, "Insufficient eth");

        _safeTransferETH(treasury, fee);
        if (msg.value > fee) {
            _safeTransferETH(msg.sender, msg.value - fee);
        }

        emit FeeCharged(msg.sender, fee);
    }

    /**
     * @notice get user name
     * @param _account     user address
     */
    function getUserName(address _account) public view returns (string memory) {
        return hasRegisteredName(_account) ? userInfo[_account].name : "";
    }

    /**
     * @notice get name owner
     * @param _name     user name
     */
    function getNameOwner(string memory _name) public view returns (address) {
        return hasRegisteredOwner(_name) ? nameInfo[_name].owner : address(0);
    }

    /**
     * @notice calculate fee
     * @param _name     user name
     */
    function calculateFee(string memory _name) public view returns (uint256) {
        return feeMultiplier * bytes(_name).length;
    }

    /**
     * @notice check if user has non-expired name
     * @param _account     user address
     */
    function hasRegisteredName(address _account) public view returns (bool) {
        return
            userInfo[_account].registeredTimestamp > 0 &&
            block.timestamp <
            userInfo[_account].registeredTimestamp + LOCK_PERIOD;
    }

    /**
     * @notice check if name has non-expired owner
     * @param _name     user name
     */
    function hasRegisteredOwner(string memory _name)
        public
        view
        returns (bool)
    {
        return
            nameInfo[_name].registeredTimestamp > 0 &&
            block.timestamp < nameInfo[_name].registeredTimestamp + LOCK_PERIOD;
    }

    /**
     * @notice pre-register name hash for commit-reveal scheme
     * @param _hash  unique hash packed from user address, name and salt
     */
    function preRegister(bytes32 _hash) external {
        require(nameCommits[_hash] == 0, "Hash already committed");
        require(!hasRegisteredName(msg.sender), "User already registered");

        nameCommits[_hash] = block.timestamp;

        emit PreRegistered(msg.sender, _hash, block.timestamp);
    }

    /**
     * @notice register name for commit-reveal scheme
     * @param _hash  unique hash packed from user address, name and salt
     * @param _name  name for register
     * @param _salt  bytes32
     */
    function register(
        bytes32 _hash,
        string memory _name,
        string memory _salt
    ) external payable {
        UserInfo storage user = userInfo[msg.sender];
        NameInfo storage name = nameInfo[_name];

        require(bytes(_name).length > 0, "Name can't be empty");
        require(nameCommits[_hash] != 0, "Hash not yet committed");
        require(
            block.timestamp >=
                nameCommits[_hash] + COMMIT_REVEAL_PENDING_PERIOD,
            "Registration can be only completed after certain time"
        );
        require(!hasRegisteredOwner(_name), "Name was already registered");
        require(!hasRegisteredName(msg.sender), "User already registered");

        require(
            keccak256(abi.encodePacked(msg.sender, _name, _salt)) == _hash,
            "Commit not matched"
        );

        // fee handler
        _chargeFee(_name);

        // main logic
        nameCommits[_hash] = 0;

        // update name info
        name.owner = msg.sender;
        name.registeredTimestamp = block.timestamp;
        name.registered = true;

        // update user info
        user.name = _name;
        user.registeredTimestamp = block.timestamp;
        user.lockedBalance = LOCK_AMOUNT;

        require(
            lockToken.transferFrom(msg.sender, address(this), LOCK_AMOUNT),
            "ERC20: transfer failed"
        );

        emit Registered(msg.sender, _name, block.timestamp);
    }

    /**
     * @notice renew name
     * @param _name  registered name
     */
    function renew(string memory _name) external payable {
        UserInfo storage user = userInfo[msg.sender];
        NameInfo storage name = nameInfo[_name];
        require(bytes(_name).length > 0, "Name can't be empty");
        require(
            keccak256(abi.encodePacked(_name)) ==
                keccak256(abi.encodePacked(user.name)),
            "Name is not matched"
        );

        // fee handler
        _chargeFee(_name);

        // main logic
        name.registeredTimestamp = block.timestamp;
        user.registeredTimestamp = block.timestamp;
        if (user.lockedBalance == 0) {
            user.lockedBalance = LOCK_AMOUNT;
            require(
                lockToken.transferFrom(msg.sender, address(this), LOCK_AMOUNT),
                "ERC20: transfer failed"
            );
        }

        emit Renewed(msg.sender, _name, block.timestamp);
    }

    /**
     * @notice withdraw locked token
     */
    function withdraw() external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];

        require(
            block.timestamp >= user.registeredTimestamp + LOCK_PERIOD,
            "Can't withdraw in lock period"
        );
        require(user.lockedBalance != 0, "Already withdrawed");

        uint256 lockedBalance = user.lockedBalance;
        user.lockedBalance = 0;
        require(
            IERC20(lockToken).transfer(msg.sender, lockedBalance),
            "ERC20: transfer failed"
        );
    }
}
