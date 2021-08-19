/*  Melvor Idle Combat Simulator

    Copyright (C) <2020>  <Coolrox95>
    Modified Copyright (C) <2020> <Visua0>
    Modified Copyright (C) <2020, 2021> <G. Miclotte>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

(() => {

    const reqs = [
        'statNames',
    ];

    const setup = () => {

        const MICSR = window.MICSR;

        /**
         * Simulator class, used for all simulation work, and storing simulation results and settings
         */
        MICSR.Simulator = class {
            /**
             *
             * @param {McsApp} parent Reference to container class
             * @param {string} workerURL URL to simulator web worker
             */
            constructor(parent, workerURL) {
                this.parent = parent;
                // Simulation settings
                /** Max number of player actions to attempt before timeout */
                this.maxActions = MICSR.maxActions;
                /** Number of enemy kills to simulate */
                this.trials = MICSR.trials;
                /** force full sim when too many actions are taken */
                this.forceFullSim = false;
                /** @type {boolean[]} */
                this.monsterSimFilter = [];
                /** @type {boolean[]} */
                this.dungeonSimFilter = [];
                this.slayerSimFilter = [];
                // not simulated reason
                this.notSimulatedReason = 'entity not simulated';
                // Simulation data;
                /** @type {MonsterSimResult[]} */
                const newSimData = (monster) => {
                    const data = {
                        simSuccess: false,
                        reason: this.notSimulatedReason,
                        xpPerSecond: 0,
                        xpPerHit: 0,
                        hpXpPerSecond: 0,
                        hpPerSecond: 0,
                        deathRate: 0,
                        highestDamageTaken: 0,
                        lowestHitpoints: Infinity,
                        atePerSecond: 0,
                        dmgPerSecond: 0,
                        avgHitDmg: 0,
                        killTimeS: 0,
                        killsPerSecond: 0,
                        gpPerSecond: 0,
                        prayerXpPerSecond: 0,
                        slayerXpPerSecond: 0,
                        summoningXpPerSecond: 0,
                        ppConsumedPerSecond: 0,
                        signetChance: 0,
                        gpFromDamagePerSecond: 0,
                        attacksTakenPerSecond: 0,
                        attacksMadePerSecond: 0,
                        simulationTime: 0,
                        petChance: 0,
                        dropChance: 0,
                    };
                    if (monster) {
                        data.inQueue = false;
                        data.petRolls = {other: []};
                    }
                    return data
                }
                this.monsterSimData = [];
                for (let i = 0; i < MONSTERS.length; i++) {
                    this.monsterSimData.push(newSimData(true));
                    this.monsterSimFilter.push(true);
                }
                /** @type {MonsterSimResult[]} */
                this.dungeonSimData = [];
                for (let i = 0; i < MICSR.dungeons.length; i++) {
                    this.dungeonSimData.push(newSimData(false));
                    this.dungeonSimFilter.push(true);
                }
                //
                this.slayerTaskMonsters = [];
                this.slayerSimData = [];
                for (let i = 0; i < this.parent.slayerTasks.length; i++) {
                    this.slayerTaskMonsters.push([]);
                    this.slayerSimData.push(newSimData(false));
                    this.slayerSimFilter.push(true);
                }
                // Pre Compute Monster Base Stats
                /** @type {EnemyStats[]} */
                this.enemyStats = [];
                for (let i = 0; i < MONSTERS.length; i++) {
                    this.enemyStats.push(this.getEnemyStats(i));
                }
                /** Variables of currently stored simulation */
                this.currentSim = this.initCurrentSim();
                // Options for time multiplier
                this.selectedPlotIsTime = true;
                // Data Export Settings
                this.exportOptions = {
                    dataTypes: [],
                    name: true,
                    dungeonMonsters: true,
                    nonSimmed: true,
                }
                for (let i = 0; i < this.parent.plotTypes.length; i++) {
                    this.exportOptions.dataTypes.push(true);
                }
                // Test Settings
                this.isTestMode = false;
                this.testMax = 10;
                this.testCount = 0;
                // Simulation queue and webworkers
                this.workerURL = workerURL;
                this.currentJob = 0;
                this.simInProgress = false;
                /** @type {SimulationJob[]} */
                this.simulationQueue = [];
                /** @type {SimulationWorker[]} */
                this.simulationWorkers = [];
                this.maxThreads = window.navigator.hardwareConcurrency;
                this.simStartTime = 0;
                /** If the current sim has been cancelled */
                this.simCancelled = false;
                // modifiers to pass to webworker
                this.constantModifiers = {
                    // legacy: pass actual item, not the modifiers
                    deadeyeAmulet: items[CONSTANTS.item.Deadeye_Amulet],
                    confettiCrossbow: items[CONSTANTS.item.Confetti_Crossbow],
                    // modifiers
                    guardianAmulet: items[CONSTANTS.item.Guardian_Amulet].modifiers,
                    occultist: items[CONSTANTS.item.Summoning_Familiar_Occultist].modifiers,
                    minotaur: items[CONSTANTS.item.Summoning_Familiar_Minotaur].modifiers,
                }
                // Create Web workers
                this.createWorkers();
            }

            /**
             * Initializes a performance test
             * @param {number} numSims number of simulations to run in a row
             * @memberof McsSimulator
             */
            runTest(numSims) {
                this.testCount = 0;
                this.isTestMode = true;
                this.testMax = numSims;
                this.simulateCombat(false);
            }

            /**
             * Creates the webworkers for simulation jobs
             */
            async createWorkers() {
                for (let i = 0; i < this.maxThreads; i++) {
                    const worker = await this.createWorker();
                    this.intializeWorker(worker, i);
                    const newWorker = {
                        worker: worker,
                        inUse: false,
                        selfTime: 0,
                    };
                    this.simulationWorkers.push(newWorker);
                }
            }

            /**
             * Attempts to create a web worker, if it fails uses a chrome hack to get a URL that works
             * @return {Promise<Worker>}
             */
            createWorker() {
                return new Promise((resolve, reject) => {
                    let newWorker;
                    try {
                        newWorker = new Worker(this.workerURL);
                        resolve(newWorker);
                    } catch (error) {
                        // Chrome Hack
                        if (error.name === 'SecurityError' && error.message.includes('Failed to construct \'Worker\': Script')) {
                            const workerContent = new XMLHttpRequest();
                            workerContent.open('GET', this.workerURL);
                            workerContent.send();
                            workerContent.addEventListener('load', (event) => {
                                const blob = new Blob([event.currentTarget.responseText], {type: 'application/javascript'});
                                this.workerURL = URL.createObjectURL(blob);
                                resolve(new Worker(this.workerURL));
                            });
                        } else { // Other Error
                            reject(error);
                        }
                    }
                });
            }

            /**
             * Intializes a simulation worker
             * @param {Worker} worker
             * @param {number} i
             */
            intializeWorker(worker, i) {
                worker.onmessage = (event) => this.processWorkerMessage(event, i);
                worker.onerror = (event) => {
                    MICSR.log('An error occured in a simulation worker');
                    MICSR.log(event);
                };
                worker.postMessage({
                    action: 'RECEIVE_GAMEDATA',
                    enemySpecialAttacks: attacks,
                    CURSEIDS: CONSTANTS.curse,
                    constantModifiers: this.constantModifiers,
                });
            }

            /**
             * Iterate through all the combatAreas and MICSR.dungeons to create a set of monsterSimData and dungeonSimData
             */
            simulateCombat(single) {
                this.setupCurrentSim(single);
                // Start simulation workers
                document.getElementById('MCS Simulate Button').textContent = `Cancel (0/${this.simulationQueue.length})`;
                this.initializeSimulationJobs();
            }

            initCurrentSim() {
                return {
                    increasedGP: 0,
                    gpBonus: 1,
                    lootBonus: 1,
                    canTopazDrop: false,
                    herbConvertChance: 0,
                    doBonesAutoBury: false,
                    /** @type {PlayerStats} */
                    playerStats: {
                        activeItems: {},
                        equipmentSelected: [],
                    },
                    /** @type {EquipmentStats} */
                    equipmentStats: {},
                    options: {},
                    prayerBonus: {modifiers: {}, vars: {}},
                    combatStats: {},
                    attackStyle: {},
                    isSlayerTask: false,
                    virtualLevels: {},
                }
            }

            setupCurrentSimCombatData(currentSim, combatData) {
                // Start by grabbing the player stats
                currentSim.playerStats = combatData.getPlayerStats();
                // base gp increase
                currentSim.increasedGP = MICSR.getModifierValue(combatData.modifiers, 'GPFromMonstersFlat');
                // multiplier gp increase
                currentSim.gpBonus = combatData.combatStats.gpBonus;
                // check for ARS drop
                currentSim.canTopazDrop = combatData.player.equipmentIDs().includes(CONSTANTS.item.Gold_Topaz_Ring);
                // loot bonus
                currentSim.lootBonus = combatData.combatStats.lootBonus;
                // misc
                currentSim.herbConvertChance = combatData.luckyHerb / 100;
                currentSim.doBonesAutoBury = (combatData.player.equipmentIDs().includes(CONSTANTS.item.Bone_Necklace));
                currentSim.isSlayerTask = combatData.isSlayerTask;
                currentSim.playerStats.isSlayerTask = combatData.isSlayerTask;
                Object.assign(currentSim.equipmentStats, combatData.equipmentStats);
                Object.assign(currentSim.prayerBonus, combatData.prayerBonus);
                Object.assign(currentSim.attackStyle, combatData.attackStyle);
                Object.assign(currentSim.virtualLevels, combatData.virtualLevels);
            }

            pushMonsterToQueue(monsterID) {
                if (!this.monsterSimData[monsterID].inQueue) {
                    this.monsterSimData[monsterID].inQueue = true;
                    this.simulationQueue.push({monsterID: monsterID});
                }
            }

            resetSingleSimulation() {
                // clear queue
                this.simulationQueue = [];
                this.resetSimDone();
                // check selection
                if (!this.parent.barSelected) {
                    this.parent.notify('There is nothing selected!', 'danger');
                    return {};
                }
                // area monster
                if (!this.parent.isViewingDungeon && this.parent.barIsMonster(this.parent.selectedBar)) {
                    const monsterID = this.parent.barMonsterIDs[this.parent.selectedBar];
                    if (this.monsterSimFilter[monsterID]) {
                        this.pushMonsterToQueue(monsterID);
                    } else {
                        this.parent.notify('The selected monster is filtered!', 'danger');
                    }
                    return {};
                }
                // dungeon
                let dungeonID = undefined;
                if (!this.parent.isViewingDungeon && this.parent.barIsDungeon(this.parent.selectedBar)) {
                    dungeonID = this.parent.barMonsterIDs[this.parent.selectedBar];
                } else if (this.parent.isViewingDungeon && this.parent.viewedDungeonID < MICSR.dungeons.length) {
                    dungeonID = this.parent.viewedDungeonID;
                }
                if (dungeonID !== undefined) {
                    if (this.dungeonSimFilter[dungeonID]) {
                        MICSR.dungeons[dungeonID].monsters.forEach(monsterID => {
                            this.pushMonsterToQueue(monsterID);
                        });
                        return {dungeonID: dungeonID};
                    }
                    this.parent.notify('The selected dungeon is filtered!', 'danger');
                    return {};
                }
                // slayer area
                let taskID = undefined;
                if (!this.parent.isViewingDungeon && this.parent.barIsTask(this.parent.selectedBar)) {
                    taskID = this.parent.barMonsterIDs[this.parent.selectedBar] - MICSR.dungeons.length;
                } else if (this.parent.isViewingDungeon && this.parent.viewedDungeonID >= MICSR.dungeons.length) {
                    taskID = this.parent.viewedDungeonID - MICSR.dungeons.length;
                }
                if (taskID !== undefined) {
                    if (this.slayerSimFilter[taskID]) {
                        this.queueSlayerTask(taskID);
                        return {taskID: taskID};
                    }
                    this.parent.notify('The selected task list is filtered!', 'danger');
                    return {};
                }
                // can't be reached
                return {};
            }

            queueSlayerTask(i) {
                const task = this.parent.slayerTasks[i];
                this.slayerTaskMonsters[i] = [];
                if (!this.slayerSimFilter[i]) {
                    return;
                }
                const minLevel = task.minLevel;
                const maxLevel = task.maxLevel === -1 ? 6969 : task.maxLevel;
                for (let monsterID = 0; monsterID < MONSTERS.length; monsterID++) {
                    // check if it is a slayer monster
                    if (!MONSTERS[monsterID].canSlayer) {
                        continue;
                    }
                    // check if combat level fits the current task type
                    const cbLevel = MICSR.getMonsterCombatLevel(monsterID, true);
                    if (cbLevel < minLevel || cbLevel > maxLevel) {
                        continue;
                    }
                    // check if the area is accessible, this only works for auto slayer
                    // without auto slayer you can get some tasks for which you don't wear/own the gear
                    let area = getMonsterArea(monsterID);
                    if (!this.parent.player.checkRequirements(area.entryRequirements)) {
                        continue;
                    }
                    // all checks passed
                    this.pushMonsterToQueue(monsterID);
                    this.slayerTaskMonsters[i].push(monsterID);
                }
            }

            resetSimulationData(single) {
                // Reset the simulation status of all enemies
                this.resetSimDone();
                // Set up simulation queue
                this.simulationQueue = [];
                if (single) {
                    this.currentSim.ids = this.resetSingleSimulation();
                    return;
                }
                // Queue simulation of monsters in combat areas
                combatAreas.forEach((area) => {
                    area.monsters.forEach((monsterID) => {
                        if (this.monsterSimFilter[monsterID]) {
                            this.pushMonsterToQueue(monsterID);
                        }
                    });
                });
                // Wandering Bard
                const bardID = 139;
                if (this.monsterSimFilter[bardID]) {
                    this.pushMonsterToQueue(bardID);
                }
                // Queue simulation of monsters in slayer areas
                slayerAreas.forEach((area) => {
                    if (!this.parent.player.checkRequirements(area.entryRequirements)) {
                        const tryToSim = area.monsters.reduce((sim, monsterID) => (this.monsterSimFilter[monsterID] && !this.monsterSimData[monsterID].inQueue) || sim, false);
                        if (tryToSim) {
                            this.parent.notify(`Can't access ${area.areaName}`, 'danger');
                            area.monsters.forEach(monsterID => {
                                this.monsterSimData[monsterID].reason = 'cannot access area';
                            });
                        }
                        return;
                    }
                    area.monsters.forEach((monsterID) => {
                        if (this.monsterSimFilter[monsterID]) {
                            this.pushMonsterToQueue(monsterID);
                        }
                    });
                });
                // Queue simulation of monsters in dungeons
                for (let i = 0; i < MICSR.dungeons.length; i++) {
                    if (this.dungeonSimFilter[i]) {
                        for (let j = 0; j < MICSR.dungeons[i].monsters.length; j++) {
                            const monsterID = MICSR.dungeons[i].monsters[j];
                            this.pushMonsterToQueue(monsterID);
                        }
                    }
                }
                // Queue simulation of monsters in slayer tasks
                for (let taskID = 0; taskID < this.slayerTaskMonsters.length; taskID++) {
                    this.queueSlayerTask(taskID);
                }
            }

            /**
             * Setup currentsim variables
             */
            setupCurrentSim(single) {
                this.simStartTime = performance.now();
                this.simCancelled = false;
                this.currentSim = this.initCurrentSim();

                // setup combat data for simulation
                this.setupCurrentSimCombatData(this.currentSim, this.parent.combatData);
                let cache = [];
                const rawCombatData = JSON.parse(JSON.stringify(this.parent.combatData, (key, value) => {
                    if (typeof value === 'object' && value !== null) {
                        // Duplicate reference found, discard key
                        if (cache.includes(value)) return;

                        // Store value in our collection
                        cache.push(value);
                    }
                    return value;
                }, 1));
                cache = null;
                this.currentSim.combatData = new MICSR.CombatData(this.parent.manager);
                Object.getOwnPropertyNames(rawCombatData).forEach(prop => this.currentSim.combatData[prop] = rawCombatData[prop]);

                // add sim options
                this.currentSim.options = {
                    trials: MICSR.trials,
                    maxActions: MICSR.maxActions,
                    forceFullSim: this.forceFullSim,
                };

                // reset and setup sim data
                this.resetSimulationData(single);
            }

            /**
             * Gets the stats of a monster
             * @param {number} monsterID
             * @return {enemyStats}
             */
            getEnemyStats(monsterID) {
                /** @type {enemyStats} */
                const attackType = MONSTERS[monsterID].attackType;
                const enemyStats = {
                    isPlayer: false,
                    // raw data
                    monsterID: monsterID,
                    attackType: attackType,
                    baseMaxHitpoints: MONSTERS[monsterID].hitpoints,
                    attackSpeed: MONSTERS[monsterID].attackSpeed,
                    isMelee: attackType === CONSTANTS.attackType.Melee,
                    isRanged: attackType === CONSTANTS.attackType.Ranged,
                    isMagic: attackType === CONSTANTS.attackType.Magic,
                    hasSpecialAttack: false,
                    specialAttackChances: [],
                    specialIDs: [],
                    specialLength: 0,
                    passiveID: [],
                    slayerArea: undefined,
                    slayerAreaEffectValue: undefined,
                    // derivative data
                    baseMaximumDefenceRoll: 0,
                    baseMaximumRangedDefenceRoll: 0,
                    baseMaximumMagicDefenceRoll: 0,
                    baseMaximumAttackRoll: 0,
                    baseMaximumStrengthRoll: 0,
                    // results - TODO: this really should not be here
                    damageTaken: 0,
                    damageHealed: 0,
                };

                // Calculate special attacks
                if (MONSTERS[monsterID].hasSpecialAttack) {
                    enemyStats.hasSpecialAttack = true;
                    for (let i = 0; i < MONSTERS[monsterID].specialAttackID.length; i++) {
                        if (MONSTERS[monsterID].overrideSpecialChances !== undefined) {
                            enemyStats.specialAttackChances.push(MONSTERS[monsterID].overrideSpecialChances[i]);
                        } else {
                            enemyStats.specialAttackChances.push(enemySpecialAttacks[MONSTERS[monsterID].specialAttackID[i]].chance);
                        }
                        enemyStats.specialIDs.push(MONSTERS[monsterID].specialAttackID[i]);
                    }
                    enemyStats.specialLength = enemyStats.specialAttackChances.length;
                }

                // add passive effects
                if (MONSTERS[monsterID].passiveID) {
                    enemyStats.passiveID = MONSTERS[monsterID].passiveID;
                }

                // TODO: refactor slayer zone assignment
                // Determine slayer zone
                let slayerIdx = 0;
                zone: for (const area of slayerAreas) {
                    for (const id of area.monsters) {
                        if (id === monsterID) {
                            enemyStats.slayerArea = slayerIdx;
                            enemyStats.slayerAreaEffectValue = area.areaEffectValue;
                            break zone;
                        }
                    }
                    slayerIdx++;
                }

                // precompute base defence rolls
                const effectiveDefenceLevel = Math.floor(MONSTERS[monsterID].defenceLevel + 8 + 1);
                enemyStats.baseMaximumDefenceRoll = effectiveDefenceLevel * (MONSTERS[monsterID].defenceBonus + 64);
                const effectiveRangedDefenceLevel = Math.floor(MONSTERS[monsterID].defenceLevel + 8 + 1);
                enemyStats.baseMaximumRangedDefenceRoll = effectiveRangedDefenceLevel * (MONSTERS[monsterID].defenceBonusRanged + 64);
                const effectiveMagicDefenceLevel = Math.floor((Math.floor(MONSTERS[monsterID].magicLevel * 0.7) + Math.floor(MONSTERS[monsterID].defenceLevel * 0.3)) + 8 + 1);
                enemyStats.baseMaximumMagicDefenceRoll = effectiveMagicDefenceLevel * (MONSTERS[monsterID].defenceBonusMagic + 64);

                // precompute base max accuracy roll
                if (enemyStats.isMelee) {
                    const effectiveAttackLevel = Math.floor(MONSTERS[monsterID].attackLevel + 8 + 1);
                    enemyStats.baseMaximumAttackRoll = effectiveAttackLevel * (MONSTERS[monsterID].attackBonus + 64);
                } else if (enemyStats.isRanged) {
                    const effectiveAttackLevel = Math.floor(MONSTERS[monsterID].rangedLevel + 8 + 1);
                    enemyStats.baseMaximumAttackRoll = effectiveAttackLevel * (MONSTERS[monsterID].attackBonusRanged + 64);
                } else if (enemyStats.isMagic) {
                    const effectiveAttackLevel = Math.floor(MONSTERS[monsterID].magicLevel + 8 + 1);
                    enemyStats.baseMaximumAttackRoll = effectiveAttackLevel * (MONSTERS[monsterID].attackBonusMagic + 64);
                }

                // precompute base max hit roll
                if (enemyStats.isMelee) {
                    const effectiveStrengthLevel = Math.floor(MONSTERS[monsterID].strengthLevel + 8 + 1);
                    enemyStats.baseMaximumStrengthRoll =
                        1.3
                        + effectiveStrengthLevel / 10
                        + MONSTERS[monsterID].strengthBonus / 80
                        + effectiveStrengthLevel * MONSTERS[monsterID].strengthBonus / 640;
                } else if (enemyStats.isRanged) {
                    const effectiveStrengthLevel = Math.floor(MONSTERS[monsterID].rangedLevel + 8 + 1);
                    enemyStats.baseMaximumStrengthRoll =
                        1.3
                        + effectiveStrengthLevel / 10
                        + MONSTERS[monsterID].strengthBonusRanged / 80
                        + effectiveStrengthLevel * MONSTERS[monsterID].strengthBonusRanged / 640;
                } else if (enemyStats.isMagic) {
                    const spell = SPELLS[MONSTERS[monsterID].selectedSpell];
                    let maxHit;
                    if (spell) {
                        maxHit = spell.maxHit;
                    } else {
                        maxHit = MONSTERS[monsterID].setMaxHit;
                    }
                    enemyStats.baseMaximumStrengthRoll = maxHit * (1 + MONSTERS[monsterID].damageBonusMagic / 100);
                }

                return enemyStats;
            }

            combineReasons(data, monsterIDs) {
                let reasons = [];
                for (const monsterID of monsterIDs) {
                    if (!this.monsterSimData[monsterID].simSuccess || this.monsterSimData[monsterID].tooManyActions > 0) {
                        data.simSuccess = false;
                    }
                    const reason = this.monsterSimData[monsterID].reason;
                    if (reason && !reasons.includes(reason)) {
                        reasons.push(reason);
                    }
                }
                if (reasons.length) {
                    data.reason = reasons.join(', ');
                    return true;
                }
                data.reason = undefined;
                return false;
            }

            computeAverageSimData(filter, data, monsterIDs) {
                // check filter
                if (!filter) {
                    data.simSuccess = false;
                    data.reason = 'entity filtered';
                    return;
                }
                // check failure and set reasons
                if (this.combineReasons(data, monsterIDs)) {
                    return;
                }
                data.simSuccess = true;

                // not time-weighted averages
                data.killTimeS = 0;
                data.deathRate = 0;
                data.highestDamageTaken = 0;
                data.lowestHitpoints = Infinity;
                data.simulationTime = 0;
                for (const monsterID of monsterIDs) {
                    data.killTimeS += this.monsterSimData[monsterID].killTimeS;
                    data.deathRate = 1 - (1 - data.deathRate) * (1 - this.monsterSimData[monsterID].deathRate);
                    data.highestDamageTaken = Math.max(data.highestDamageTaken, this.monsterSimData[monsterID].highestDamageTaken);
                    data.lowestHitpoints = Math.min(data.lowestHitpoints, this.monsterSimData[monsterID].lowestHitpoints);
                    data.simulationTime += this.monsterSimData[monsterID].simulationTime;
                }

                // time-weighted averages
                const computeAvg = (tag) => {
                    data[tag] = this.monsterSimData.filter((_, i) => monsterIDs.includes(i))
                        .reduce((avgData, mData) => avgData + mData[tag] * mData.killTimeS, 0) / data.killTimeS;
                }
                [
                    // xp rates
                    'xpPerSecond',
                    'hpXpPerSecond',
                    'slayerXpPerSecond',
                    'prayerXpPerSecond',
                    'summoningXpPerSecond',
                    // consumables
                    'ppConsumedPerSecond',
                    'ammoUsedPerSecond',
                    'runesUsedPerSecond',
                    'combinationRunesUsedPerSecond',
                    'potionsUsedPerSecond',
                    'tabletsUsedPerSecond',
                    'atePerSecond',
                    // survivability
                    // 'deathRate',
                    // 'highestDamageTaken',
                    // 'lowestHitpoints',
                    // kill time
                    // 'killTimeS',
                    'killsPerSecond',
                    // loot gains
                    'gpPerSecond',
                    'dropChance',
                    'signetChance',
                    'petChance',
                    'slayerCoinsPerSecond',
                    // unsorted
                    'dmgPerSecond',
                    'attacksMadePerSecond',
                    'attacksTakenPerSecond',
                    // 'simulationTime',
                ].forEach(tag => computeAvg(tag));
            }

            computeRuneUsage(runes, combinationRunes, runeCosts, castsPerSecond, preservation) {
                runeCosts.forEach(x => {
                    const runeID = x.id;
                    const qty = x.qty * castsPerSecond * (1 - preservation / 100);
                    if (items[runeID].providesRune && items[runeID].providesRune.length > 1) {
                        combinationRunes[runeID] = qty + (combinationRunes[runeID] || 0);
                    } else {
                        runes[runeID] = qty + (runes[runeID] || 0);
                    }
                });
            }

            computeAllRuneUsage() {
                // compute rune usage
                const runeCosts = this.currentSim.playerStats.runeCosts;
                const preservation = this.currentSim.playerStats.runePreservation;
                for (let data of this.monsterSimData) {
                    let runes = {};
                    let combinationRunes = {};
                    this.computeRuneUsage(runes, combinationRunes, runeCosts.spell, data.spellCastsPerSecond, preservation);
                    this.computeRuneUsage(runes, combinationRunes, runeCosts.aurora, data.spellCastsPerSecond, preservation);
                    this.computeRuneUsage(runes, combinationRunes, runeCosts.curse, data.curseCastsPerSecond, preservation);
                    data.runesUsedPerSecond = Object.values(runes).reduce((a, b) => a + b, 0);
                    data.combinationRunesUsedPerSecond = Object.values(combinationRunes).reduce((a, b) => a + b, 0);
                }
            }

            computePotionUsage(combatData, monsterSimData) {
                for (let data of monsterSimData) {
                    data.potionsUsedPerSecond = 0;
                }
                if (!combatData.potionSelected) {
                    return;
                }
                const modifiers = combatData.modifiers;
                // check prayers for divine potion
                let perPlayer = false;
                let perEnemy = false;
                let perRegen = false;
                if (combatData.potionID === 22) {
                    for (let i = 0; i < PRAYER.length; i++) {
                        if (combatData.prayerSelected[i]) {
                            perPlayer = perPlayer || PRAYER[i].pointsPerPlayer > 0;
                            perEnemy = perEnemy || PRAYER[i].pointsPerEnemy > 0;
                            perRegen = perRegen || PRAYER[i].pointsPerRegen > 0;
                        }
                    }
                }
                const potionPreservation = MICSR.getModifierValue(modifiers, 'ChanceToPreservePotionCharge');
                const potion = items[herbloreItemData[combatData.potionID].itemID[combatData.potionTier]];
                const potionCharges = potion.potionCharges + MICSR.getModifierValue(modifiers, 'PotionChargesFlat');
                // set potion usage for each monster
                for (let data of monsterSimData) {
                    let chargesUsedPerSecond = 0;
                    if (combatData.potionID === 5) {
                        // regen potion
                        chargesUsedPerSecond = 0.1;
                    } else if (combatData.potionID === 6) {
                        // damage reduction potion
                        chargesUsedPerSecond = data.attacksTakenPerSecond;
                    } else if (combatData.potionID === 23) {
                        // lucky herb potion
                        chargesUsedPerSecond = data.killsPerSecond;
                    } else if (combatData.potionID === 22) {
                        // divine potion
                        if (perPlayer) {
                            chargesUsedPerSecond += data.attacksMadePerSecond;
                        }
                        if (perEnemy) {
                            chargesUsedPerSecond += data.attacksTakenPerSecond;
                        }
                        if (perRegen) {
                            chargesUsedPerSecond += 0.1;
                        }
                    } else {
                        chargesUsedPerSecond = data.attacksMadePerSecond;
                    }
                    // take potion preservation into account
                    if (potionPreservation > 0) {
                        chargesUsedPerSecond *= 1 - potionPreservation / 100;
                    }
                    // convert charges to potions
                    data.potionsUsedPerSecond = chargesUsedPerSecond / potionCharges;
                }
            }

            /** Performs all data analysis post queue completion */
            performPostSimAnalysis() {
                // this.computeAllRuneUsage();
                // this.computePotionUsage(this.currentSim.combatData, this.monsterSimData);
                // Perform calculation of dungeon stats
                for (let dungeonId = 0; dungeonId < MICSR.dungeons.length; dungeonId++) {
                    this.computeAverageSimData(this.dungeonSimFilter[dungeonId], this.dungeonSimData[dungeonId], MICSR.dungeons[dungeonId].monsters);
                }
                for (let slayerTaskID = 0; slayerTaskID < this.slayerTaskMonsters.length; slayerTaskID++) {
                    this.computeAverageSimData(this.slayerSimFilter[slayerTaskID], this.slayerSimData[slayerTaskID], this.slayerTaskMonsters[slayerTaskID]);
                    // correct average kps for auto slayer
                    this.slayerSimData[slayerTaskID].killsPerSecond *= this.slayerTaskMonsters[slayerTaskID].length;
                    // correct average kill time for auto slayer
                    this.slayerSimData[slayerTaskID].killTimeS /= this.slayerTaskMonsters[slayerTaskID].length;
                    // log monster IDs
                    if (this.slayerTaskMonsters[slayerTaskID].length) {
                        MICSR.log(`Tier ${slayerTaskID} auto slayer task list`, this.slayerTaskMonsters[slayerTaskID]);
                    }
                }
                // Update other data
                this.parent.loot.update(
                    this.currentSim,
                    this.monsterSimData,
                    this.dungeonSimData,
                    this.slayerSimData,
                    this.slayerTaskMonsters,
                );
                MICSR.log(`Elapsed Simulation Time: ${performance.now() - this.simStartTime}ms`);
                // store simulation
                if (this.parent.trackHistory) {
                    const save = {
                        settings: this.parent.import.exportSettings(),
                        export: '',
                        monsterSimData: this.monsterSimData.map(x => {
                            return {...x};
                        }),
                        dungeonSimData: this.dungeonSimData.map(x => {
                            return {...x};
                        }),
                        slayerSimData: this.slayerSimData.map(x => {
                            return {...x};
                        }),
                    }
                    save.export = JSON.stringify(save.settings, null, 1);
                    this.parent.savedSimulations.push(save);
                    this.parent.createCompareCard();
                }
            }

            /** Starts processing simulation jobs */
            initializeSimulationJobs() {
                if (!this.simInProgress) {
                    if (this.simulationQueue.length > 0) {
                        this.simInProgress = true;
                        this.currentJob = 0;
                        for (let i = 0; i < this.simulationWorkers.length; i++) {
                            this.simulationWorkers[i].selfTime = 0;
                            if (i < this.simulationQueue.length) {
                                this.startJob(i);
                            } else {
                                break;
                            }
                        }
                    } else {
                        this.performPostSimAnalysis();
                        this.parent.updateDisplayPostSim();
                    }
                }
            }

            /** Starts a job for a given worker
             * @param {number} workerID
             */
            startJob(workerID) {
                if (this.currentJob < this.simulationQueue.length && !this.simCancelled) {
                    const monsterID = this.simulationQueue[this.currentJob].monsterID;
                    this.modifyCurrentSimStatsForMonster(monsterID);
                    this.simulationWorkers[workerID].worker.postMessage({
                        action: 'START_SIMULATION',
                        monsterID: monsterID,
                        combatData: JSON.parse(JSON.stringify(this.currentSim.combatData, null, 1)),
                        enemyStats: this.enemyStats[monsterID],
                        playerStats: this.currentSim.playerStats,
                        simOptions: this.currentSim.options,
                        verbose: this.parent.verbose,
                        veryVerbose: this.parent.veryVerbose,
                    });
                    this.simulationWorkers[workerID].inUse = true;
                    this.currentJob++;
                } else {
                    // Check if none of the workers are in use
                    let allDone = true;
                    this.simulationWorkers.forEach((simWorker) => {
                        if (simWorker.inUse) {
                            allDone = false;
                        }
                    });
                    if (allDone) {
                        this.simInProgress = false;
                        this.performPostSimAnalysis();
                        this.parent.updateDisplayPostSim();
                        if (this.isTestMode) {
                            this.testCount++;
                            if (this.testCount < this.testMax) {
                                this.simulateCombat(false);
                            } else {
                                this.isTestMode = false;
                            }
                        }
                        // MICSR.log(this.simulationWorkers);
                    }
                }
            }

            /**
             * Modifies the playerStats before starting a job for a specific monster
             * @param {number} monsterID Index of MONSTERS
             */
            // TODO: move this to combatData?
            modifyCurrentSimStatsForMonster(monsterID) {
                const combatData = this.currentSim.combatData;
                const combatStats = combatData.combatStats;
                const modifiers = combatData.modifiers;

                // Do preprocessing of player stats for special weapons
                if (this.currentSim.playerStats.activeItems.stormsnap
                    || this.currentSim.playerStats.activeItems.slayerCrossbow
                    || this.currentSim.playerStats.activeItems.bigRon
                    || modifiers.summoningSynergy_6_7
                    || modifiers.summoningSynergy_7_8
                    || modifiers.summoningSynergy_6_13
                    || modifiers.summoningSynergy_7_13
                    || modifiers.summoningSynergy_8_13) {
                    // recompute base stats
                    const baseStats = combatData.updatePlayerBaseStats(monsterID);
                    // max attack roll
                    combatStats.maxAttackRoll = combatData.player.stats.accuracy;
                    // max hit roll
                    combatStats.baseMeleeMaxHit = combatData.baseMeleeMaxHit(baseStats);
                    combatStats.maxHit = combatData.player.stats.maxHit;
                    // update player stats
                    this.currentSim.playerStats = combatData.getPlayerStats();
                }

                const playerStats = this.currentSim.playerStats;
                const prayerVars = combatData.prayerBonus.vars;

                // Do check for protection prayer
                switch (MONSTERS[monsterID].attackType) {
                    case CONSTANTS.attackType.Melee:
                        playerStats.isProtected = prayerVars.prayerBonusProtectFromMelee > 0;
                        break;
                    case CONSTANTS.attackType.Ranged:
                        playerStats.isProtected = prayerVars.prayerBonusProtectFromRanged > 0;
                        break;
                    case CONSTANTS.attackType.Magic:
                        playerStats.isProtected = prayerVars.prayerBonusProtectFromMagic > 0;
                        break;
                }

                // Do preprocessing of player damage bonus vs monster
                let dmgModifier = 0;
                if (MONSTERS[monsterID].isBoss) {
                    dmgModifier += MICSR.getModifierValue(modifiers, 'DamageToBosses', CONSTANTS.skill.Slayer);
                }
                if (combatData.isSlayerTask) {
                    dmgModifier += MICSR.getModifierValue(modifiers, 'DamageToSlayerTasks', CONSTANTS.skill.Slayer);
                }
                switch (getMonsterArea(monsterID).areaType) {
                    // TODO: this does not work
                    case 'Combat':
                        dmgModifier += MICSR.getModifierValue(modifiers, 'DamageToCombatAreaMonsters', CONSTANTS.skill.Slayer);
                        break;
                    case 'Slayer':
                        dmgModifier += MICSR.getModifierValue(modifiers, 'DamageToSlayerAreaMonsters', CONSTANTS.skill.Slayer);
                        break;
                    case 'Dungeon':
                        dmgModifier += MICSR.getModifierValue(modifiers, 'DamageToDungeonMonsters', CONSTANTS.skill.Slayer);
                        break;
                }
                dmgModifier += MICSR.getModifierValue(modifiers, 'DamageToAllMonsters', CONSTANTS.skill.Slayer);
                playerStats.dmgModifier = dmgModifier;
            }

            /**
             * Attempts to cancel the currently running simulation and sends a cancelation message to each of the active workers
             */
            cancelSimulation() {
                this.simCancelled = true;
                this.simulationWorkers.forEach((simWorker) => {
                    if (simWorker.inUse) {
                        simWorker.worker.postMessage({action: 'CANCEL_SIMULATION'});
                    }
                });
            }

            /**
             * Processes a message received from one of the simulation workers
             * @param {MessageEvent} event The event data of the worker
             * @param {number} workerID The ID of the worker that sent the message
             */
            processWorkerMessage(event, workerID) {
                // MICSR.log(`Received Message ${event.data.action} from worker: ${workerID}`);
                if (!event.data.simResult.simSuccess || event.data.simResult.tooManyActions > 0) {
                    MICSR.log({...event.data.simResult});
                }
                switch (event.data.action) {
                    case 'FINISHED_SIM':
                        // Send next job in queue to worker
                        this.simulationWorkers[workerID].inUse = false;
                        this.simulationWorkers[workerID].selfTime += event.data.selfTime;
                        // Transfer data into monsterSimData
                        const monsterID = event.data.monsterID;
                        Object.assign(this.monsterSimData[monsterID], event.data.simResult);
                        this.monsterSimData[monsterID].simulationTime = event.data.selfTime;
                        document.getElementById('MCS Simulate Button').textContent = `Cancel (${this.currentJob - 1}/${this.simulationQueue.length})`;
                        // MICSR.log(event.data.simResult);
                        // Attempt to add another job to the worker
                        this.startJob(workerID);
                        break;
                    case 'ERR_SIM':
                        MICSR.error(event.data.error);
                        break;
                }
            }

            /**
             * Resets the simulation status for each monster
             */
            resetSimDone() {
                for (let i = 0; i < MONSTERS.length; i++) {
                    this.monsterSimData[i].inQueue = false;
                    this.monsterSimData[i].simSuccess = false;
                    this.monsterSimData[i].reason = this.notSimulatedReason;
                }
            }

            /**
             * Extracts a set of data for plotting that matches the keyValue in monsterSimData and dungeonSimData
             * @param {string} keyValue
             * @return {number[]}
             */
            getDataSet(keyValue) {
                let dataMultiplier = 1;
                if (this.selectedPlotIsTime) {
                    dataMultiplier = this.parent.timeMultiplier;
                }
                let isKillTime = (this.parent.timeMultiplier === -1 && this.selectedPlotIsTime);
                if (keyValue === 'petChance') {
                    isKillTime = false;
                    dataMultiplier = 1;
                }
                const dataSet = [];
                if (!this.parent.isViewingDungeon) {
                    // Compile data from monsters in combat zones
                    combatAreas.forEach((area) => {
                        area.monsters.forEach((monsterID) => {
                            if (isKillTime) dataMultiplier = this.monsterSimData[monsterID].killTimeS;
                            dataSet.push((this.monsterSimFilter[monsterID] && this.monsterSimData[monsterID].simSuccess) ? this.monsterSimData[monsterID][keyValue] * dataMultiplier : NaN);
                        });
                    });
                    // Wandering Bard
                    const bardID = 139;
                    if (isKillTime) dataMultiplier = this.monsterSimData[bardID].killTimeS;
                    dataSet.push((this.monsterSimFilter[bardID] && this.monsterSimData[bardID].simSuccess) ? this.monsterSimData[bardID][keyValue] * dataMultiplier : NaN);
                    // Compile data from monsters in slayer zones
                    slayerAreas.forEach((area) => {
                        area.monsters.forEach((monsterID) => {
                            if (isKillTime) dataMultiplier = this.monsterSimData[monsterID].killTimeS;
                            dataSet.push((this.monsterSimFilter[monsterID] && this.monsterSimData[monsterID].simSuccess) ? this.monsterSimData[monsterID][keyValue] * dataMultiplier : NaN);
                        });
                    });
                    // Perform simulation of monsters in dungeons
                    for (let i = 0; i < MICSR.dungeons.length; i++) {
                        if (isKillTime) dataMultiplier = this.dungeonSimData[i].killTimeS;
                        dataSet.push((this.dungeonSimFilter[i] && this.dungeonSimData[i].simSuccess) ? this.dungeonSimData[i][keyValue] * dataMultiplier : NaN);
                    }
                    // Perform simulation of monsters in slayer tasks
                    for (let i = 0; i < this.slayerTaskMonsters.length; i++) {
                        if (isKillTime) dataMultiplier = this.slayerSimData[i].killTimeS;
                        dataSet.push((this.slayerSimFilter[i] && this.slayerSimData[i].simSuccess) ? this.slayerSimData[i][keyValue] * dataMultiplier : NaN);
                    }
                } else if (this.parent.viewedDungeonID < MICSR.dungeons.length) {
                    // dungeons
                    const dungeonID = this.parent.viewedDungeonID;
                    const isSignet = keyValue === 'signetChance';
                    MICSR.dungeons[dungeonID].monsters.forEach((monsterID) => {
                        if (!isSignet) {
                            if (isKillTime) dataMultiplier = this.monsterSimData[monsterID].killTimeS;
                            dataSet.push((this.monsterSimData[monsterID].simSuccess) ? this.monsterSimData[monsterID][keyValue] * dataMultiplier : NaN);
                        } else {
                            dataSet.push(0);
                        }
                    });
                    if (isSignet) {
                        const bossId = MICSR.dungeons[dungeonID].monsters[MICSR.dungeons[dungeonID].monsters.length - 1];
                        dataSet[dataSet.length - 1] = (this.monsterSimData[bossId].simSuccess) ? this.monsterSimData[bossId][keyValue] * dataMultiplier : NaN;
                    }
                } else {
                    // slayer tasks
                    const taskID = this.parent.viewedDungeonID - MICSR.dungeons.length;
                    const isSignet = keyValue === 'signetChance';
                    this.slayerTaskMonsters[taskID].forEach(monsterID => {
                        if (!isSignet) {
                            if (isKillTime) dataMultiplier = this.monsterSimData[monsterID].killTimeS;
                            dataSet.push((this.monsterSimData[monsterID].simSuccess) ? this.monsterSimData[monsterID][keyValue] * dataMultiplier : NaN);
                        } else {
                            dataSet.push(0);
                        }
                    });
                }
                return dataSet;
            }

            getRawData() {
                const dataSet = [];
                if (!this.parent.isViewingDungeon) {
                    // Compile data from monsters in combat zones
                    combatAreas.forEach((area) => {
                        area.monsters.forEach((monsterID) => {
                            dataSet.push(this.monsterSimData[monsterID]);
                        });
                    });
                    // Wandering Bard
                    const bardID = 139;
                    dataSet.push(this.monsterSimData[bardID]);
                    // Compile data from monsters in slayer zones
                    slayerAreas.forEach((area) => {
                        area.monsters.forEach((monsterID) => {
                            dataSet.push(this.monsterSimData[monsterID]);
                        });
                    });
                    // Perform simulation of monsters in dungeons
                    for (let i = 0; i < MICSR.dungeons.length; i++) {
                        dataSet.push(this.dungeonSimData[i]);
                    }
                    // Perform simulation of monsters in slayer tasks
                    for (let i = 0; i < this.slayerTaskMonsters.length; i++) {
                        dataSet.push(this.slayerSimData[i]);
                    }
                } else if (this.parent.viewedDungeonID < MICSR.dungeons.length) {
                    // dungeons
                    const dungeonID = this.parent.viewedDungeonID;
                    MICSR.dungeons[dungeonID].monsters.forEach((monsterID) => {
                        dataSet.push(this.monsterSimData[monsterID]);
                    });
                } else {
                    // slayer tasks
                    const taskID = this.parent.viewedDungeonID - MICSR.dungeons.length;
                    this.slayerTaskMonsters[taskID].forEach(monsterID => {
                        dataSet.push(this.monsterSimData[monsterID]);
                    });
                }
                return dataSet;
            }

            exportEntity(exportOptions, entityID, filter, data, isDungeonMonster = false, nameOverride = undefined) {
                const name = nameOverride !== undefined ? nameOverride : this.parent.getMonsterName(entityID);
                const exportLine = [];
                if (!exportOptions.nonSimmed && !filter[entityID]) {
                    return exportLine;
                }
                if (exportOptions.name) {
                    exportLine.push(name);
                }
                for (let i = 0; i < this.parent.plotTypes.length; i++) {
                    if (!exportOptions.dataTypes[i]) {
                        continue;
                    }
                    if (isDungeonMonster) {
                        if (this.parent.plotTypes[i].value === 'signetChance') {
                            exportLine.push(0);
                        } else {
                            let dataMultiplier = this.parent.plotTypes[i].isTime ? this.parent.timeMultipliers[1] : 1;
                            if (dataMultiplier === -1) dataMultiplier = data[entityID].killTimeS;
                            exportLine.push((data[entityID].simSuccess) ? data[entityID][this.parent.plotTypes[i].value] * dataMultiplier : 0);
                        }
                    } else {
                        let dataMultiplier = this.parent.plotTypes[i].isTime ? this.parent.timeMultipliers[1] : 1;
                        if (dataMultiplier === -1) dataMultiplier = data[entityID].killTimeS;
                        exportLine.push((filter[entityID] && data[entityID].simSuccess) ? data[entityID][this.parent.plotTypes[i].value] * dataMultiplier : 0);
                    }
                }
                return exportLine;
            }

            /**
             * Creates a string to paste into your favourite spreadsheet software
             * @return {string}
             */
            exportData() {
                // settings
                const exportOptions = this.exportOptions;

                // header
                const headerLine = [];
                if (exportOptions.name) {
                    headerLine.push('Monster/Dungeon Name');
                }
                for (let i = 0; i < this.parent.plotTypes.length; i++) {
                    if (exportOptions.dataTypes[i]) {
                        if (this.parent.plotTypes[i].isTime) {
                            headerLine.push(this.parent.plotTypes[i].option + this.parent.timeOptions[1]);
                        } else {
                            headerLine.push(this.parent.plotTypes[i].option);
                        }
                    }
                }

                // result
                let exportString = [
                    headerLine,
                ];

                // Combat Areas
                combatAreas.forEach((area) => {
                    area.monsters.forEach(monsterID => exportString.push(this.exportEntity(exportOptions, monsterID, this.monsterSimFilter, this.monsterSimData)));
                });
                // Wandering Bard
                const bardID = 139;
                exportString.push(this.exportEntity(exportOptions, bardID, this.monsterSimFilter, this.monsterSimData));
                // Slayer Areas
                slayerAreas.forEach((area) => {
                    area.monsters.forEach(monsterID => exportString.push(this.exportEntity(exportOptions, monsterID, this.monsterSimFilter, this.monsterSimData)));
                });
                // Dungeons
                for (let dungeonId = 0; dungeonId < MICSR.dungeons.length; dungeonId++) {
                    // dungeon
                    exportString.push(this.exportEntity(exportOptions, dungeonId, this.dungeonSimFilter, this.dungeonSimData, false, this.parent.getDungeonName(dungeonId)));
                    // dungeon monsters
                    if (exportOptions.dungeonMonsters) {
                        const dungeonMonsterFilter = Object.fromEntries(MICSR.dungeons[dungeonId].monsters.map((id) => [id, this.dungeonSimFilter[dungeonId]]));
                        MICSR.dungeons[dungeonId].monsters.forEach(monsterID => exportString.push(this.exportEntity(exportOptions, monsterID, dungeonMonsterFilter, this.monsterSimData, true)));
                    }
                }
                // TODO: export for auto slayer

                // add column separators
                exportString = exportString.map(row => row.join('\t'));
                // add row separators
                exportString = exportString.join('\n');
                // return the export string
                return exportString;
            }

            /**
             * Finds the monsters/dungeons you can currently fight
             * @return {boolean[]}
             */
            getEnterSet() {
                const enterSet = [];
                // Compile data from monsters in combat zones
                for (let i = 0; i < combatAreas.length; i++) {
                    for (let j = 0; j < combatAreas[i].monsters.length; j++) {
                        enterSet.push(true);
                    }
                }
                // Wandering Bard
                enterSet.push(true);
                // Check which slayer areas we can access with current stats and equipment
                for (const area of slayerAreas) {
                    // push `canEnter` for every monster in this zone
                    for (let j = 0; j < area.monsters.length; j++) {
                        enterSet.push(this.parent.player.checkRequirements(area.entryRequirements));
                    }
                }
                // Perform simulation of monsters in dungeons and auto slayer
                for (let i = 0; i < MICSR.dungeons.length; i++) {
                    enterSet.push(true);
                }
                for (let i = 0; i < this.slayerTaskMonsters.length; i++) {
                    enterSet.push(true);
                }
                return enterSet;
            }
        }
    }

    let loadCounter = 0;
    const waitLoadOrder = (reqs, setup, id) => {
        if (characterSelected && !characterLoading) {
            loadCounter++;
        }
        if (loadCounter > 100) {
            console.log('Failed to load ' + id);
            return;
        }
        // check requirements
        let reqMet = characterSelected && !characterLoading;
        if (window.MICSR === undefined) {
            reqMet = false;
            console.log(id + ' is waiting for the MICSR object');
        } else {
            for (const req of reqs) {
                if (window.MICSR.loadedFiles[req]) {
                    continue;
                }
                reqMet = false;
                // not defined yet: try again later
                if (loadCounter === 1) {
                    window.MICSR.log(id + ' is waiting for ' + req);
                }
            }
        }
        if (!reqMet) {
            setTimeout(() => waitLoadOrder(reqs, setup, id), 50);
            return;
        }
        // requirements met
        window.MICSR.log('setting up ' + id);
        setup();
        // mark as loaded
        window.MICSR.loadedFiles[id] = true;
    }
    waitLoadOrder(reqs, setup, 'Simulator');

})();