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

    const reqs = [];

    const setup = () => {

        const MICSR = window.MICSR;

        /**
         * Loot class, used for all loot related work
         */
        MICSR.Loot = class {

            constructor(app, simulator) {
                this.app = app;
                this.simulator = simulator;

                // TODO: set some default values ?
                this.currentSim = {};
                this.modifiers = {};
                this.monsterSimData = {};
                this.dungeonSimData = {};
                this.slayerSimData = {};
                this.slayerTaskMonsters = [];

                // Pet Settings
                this.petSkill = 'Attack';
                // Options for GP/s calculations
                this.sellBones = false; // True or false
                this.convertShards = false;

                /** Number of hours to farm for signet ring */
                this.signetFarmTime = 1;
            }


            /**
             * Computes the average number of coins that a monster drops
             * @param {number} monsterID Index of MONSTERS
             * @return {number}
             */
            computeAverageCoins(monsterID) {
                let coinsToDrop = Math.max(0, (MONSTERS[monsterID].dropCoins[1] + MONSTERS[monsterID].dropCoins[0] - 1) / 2);
                coinsToDrop += this.currentSim.increasedGP;
                let coinDropModifier = this.currentSim.gpBonus;
                if (this.modifiers.summoningSynergy_0_15) {
                    coinDropModifier += this.monsterSimData[monsterID].burningEnemyKilledRate * this.modifiers.summoningSynergy_0_15 / 100;
                }
                // apply multiplier
                return coinsToDrop * coinDropModifier;
            }

            /**
             * Computes the chance that a monster will drop loot when it dies
             * @param {number} monsterID
             * @return {number}
             */
            computeLootChance(monsterID) {
                return ((MONSTERS[monsterID].lootChance !== undefined) ? MONSTERS[monsterID].lootChance / 100 : 1);
            }

            /**
             * Computes the value of a monsters drop table respecting the loot sell settings
             * @param {number} monsterID
             * @return {number}
             */
            computeDropTableValue(monsterID) {
                // lootTable[x][0]: Item ID, [x][1]: Weight [x][2]: Max Qty
                if (MONSTERS[monsterID].lootTable) {
                    let gpWeight = 0;
                    let totWeight = 0;
                    MONSTERS[monsterID].lootTable.forEach((x) => {
                        const itemID = x[0];
                        let avgQty = (x[2] + 1) / 2;
                        if (items[itemID].canOpen) {
                            gpWeight += this.computeChestOpenValue(itemID) * avgQty;
                        } else {
                            if (this.currentSim.herbConvertChance && (items[itemID].tier === 'Herb' && items[itemID].type === 'Seeds')) {
                                avgQty += 3;
                                gpWeight += (items[itemID].sellsFor * (1 - this.currentSim.herbConvertChance) + items[items[itemID].grownItemID].sellsFor * this.currentSim.herbConvertChance) * x[1] * avgQty;
                            } else {
                                gpWeight += items[itemID].sellsFor * x[1] * avgQty;
                            }
                        }
                        totWeight += x[1];
                    });
                    return gpWeight / totWeight * this.currentSim.lootBonus;
                }
            }

            /**
             * Computes the value of the contents of a chest respecting the loot sell settings
             * @param {number} chestID
             * @return {number}
             */
            computeChestOpenValue(chestID) {
                let gpWeight = 0;
                let totWeight = 0;
                let avgQty;
                for (let i = 0; i < items[chestID].dropTable.length; i++) {
                    if ((items[chestID].dropQty !== undefined) && (items[chestID].dropQty[i] !== undefined)) {
                        avgQty = (items[chestID].dropQty[i] + 1) / 2;
                    } else {
                        avgQty = 1;
                    }
                    gpWeight += avgQty * items[items[chestID].dropTable[i][0]].sellsFor * items[chestID].dropTable[i][1];
                    totWeight += items[chestID].dropTable[i][1];
                }
                return gpWeight / totWeight;
            }

            /**
             * Computes the average amount of GP earned when killing a monster, respecting the loot sell settings
             * @param {number} monsterID
             * @return {number}
             */
            computeMonsterValue(monsterID) {
                let monsterValue = 0;

                // loot and signet are affected by loot chance
                monsterValue += this.computeDropTableValue(monsterID);
                if (this.currentSim.canTopazDrop) {
                    monsterValue += items[CONSTANTS.item.Signet_Ring_Half_B].sellsFor * MICSR.getMonsterCombatLevel(monsterID) / 500000;
                }
                monsterValue *= this.computeLootChance(monsterID);

                // coin and bones drops are not affected by loot chance
                monsterValue += this.computeAverageCoins(monsterID);
                if (this.sellBones && !this.currentSim.doBonesAutoBury && MONSTERS[monsterID].bones) {
                    monsterValue += items[MONSTERS[monsterID].bones].sellsFor * this.currentSim.lootBonus * ((MONSTERS[monsterID].boneQty) ? MONSTERS[monsterID].boneQty : 1);
                }

                return monsterValue;
            }

            /**
             * Computes the average amount of GP earned when completing a dungeon, respecting the loot sell settings
             * @param {number} dungeonID
             * @return {number}
             */
            computeDungeonValue(dungeonID) {
                let dungeonValue = 0;
                // TODO: should double everything that appears in the droptable of the boss monster, not just chests
                MICSR.dungeons[dungeonID].rewards.forEach((reward) => {
                    if (items[reward].canOpen) {
                        dungeonValue += this.computeChestOpenValue(reward) * this.currentSim.lootBonus;
                    } else {
                        dungeonValue += items[reward].sellsFor;
                    }
                });
                // Shards
                if (godDungeonID.includes(dungeonID)) {
                    let shardCount = 0;
                    const shardID = MONSTERS[MICSR.dungeons[dungeonID].monsters[0]].bones;
                    MICSR.dungeons[dungeonID].monsters.forEach((monsterID) => {
                        shardCount += MONSTERS[monsterID].boneQty || 1;
                    });
                    shardCount *= this.currentSim.lootBonus;
                    if (this.convertShards) {
                        const chestID = items[shardID].trimmedItemID;
                        dungeonValue += shardCount / items[chestID].itemsRequired[0][1] * this.computeChestOpenValue(chestID);
                    } else {
                        dungeonValue += shardCount * items[shardID].sellsFor;
                    }
                }
                if (this.currentSim.canTopazDrop) {
                    dungeonValue += items[CONSTANTS.item.Signet_Ring_Half_B].sellsFor * MICSR.getMonsterCombatLevel(MICSR.dungeons[dungeonID].monsters[MICSR.dungeons[dungeonID].monsters.length - 1]) / 500000;
                }
                dungeonValue += this.computeAverageCoins(MICSR.dungeons[dungeonID].monsters[MICSR.dungeons[dungeonID].monsters.length - 1]);
                return dungeonValue;
            }

            /**
             * Update all loot related statistics
             */
            update(currentSim, monsterSimData, dungeonSimData, slayerSimData, slayerTaskMonsters) {
                if (currentSim !== undefined) {
                    this.currentSim = currentSim;
                    this.modifiers = currentSim.combatData.modifiers;
                    this.monsterSimData = monsterSimData;
                    this.dungeonSimData = dungeonSimData;
                    this.slayerSimData = slayerSimData;
                    this.slayerTaskMonsters = slayerTaskMonsters;
                }
                this.updateGPData();
                this.updateSignetChance();
                this.updateDropChance();
                this.updateSlayerXP();
                this.updateSlayerCoins();
                this.updatePetChance();
            }

            /**
             * Computes the gp/kill and gp/s data for monsters and dungeons and sets those values.
             */
            updateGPData() {
                // Set data for monsters in combat zones
                if (this.app.isViewingDungeon && this.app.viewedDungeonID < MICSR.dungeons.length) {
                    MICSR.dungeons[this.app.viewedDungeonID].monsters.forEach((monsterID) => {
                        if (!this.monsterSimData[monsterID]) {
                            return;
                        }
                        if (this.monsterSimData[monsterID].simSuccess && this.monsterSimData[monsterID].tooManyActions === 0) {
                            let gpPerKill = 0;
                            if (godDungeonID.includes(this.app.viewedDungeonID)) {
                                const boneQty = MONSTERS[monsterID].boneQty || 1;
                                const shardID = MONSTERS[monsterID].bones;
                                if (this.convertShards) {
                                    const chestID = items[shardID].trimmedItemID;
                                    gpPerKill += boneQty * this.currentSim.lootBonus / items[chestID].itemsRequired[0][1] * this.computeChestOpenValue(chestID);
                                } else {
                                    gpPerKill += boneQty * this.currentSim.lootBonus * items[shardID].sellsFor;
                                }
                            }
                            this.monsterSimData[monsterID].gpPerSecond = this.monsterSimData[monsterID].gpFromDamagePerSecond + gpPerKill / this.monsterSimData[monsterID].killTimeS;
                        } else {
                            this.monsterSimData[monsterID].gpPerSecond = 0;
                        }
                    });
                } else {
                    const updateMonsterGP = (monsterID) => {
                        if (!this.monsterSimData[monsterID]) {
                            return;
                        }
                        this.monsterSimData[monsterID].gpPerSecond = this.monsterSimData[monsterID].gpFromDamagePerSecond;
                        if (this.monsterSimData[monsterID].simSuccess && this.monsterSimData[monsterID].tooManyActions === 0) {
                            this.monsterSimData[monsterID].gpPerSecond += this.computeMonsterValue(monsterID) / this.monsterSimData[monsterID].killTimeS;
                        }
                    };
                    // Combat areas
                    combatAreas.forEach(area => {
                        area.monsters.forEach(monsterID => updateMonsterGP(monsterID));
                    });
                    // Wandering Bard
                    const bardID = 139;
                    updateMonsterGP(bardID);
                    // Slayer areas
                    slayerAreas.forEach(area => {
                        area.monsters.forEach(monsterID => updateMonsterGP(monsterID));
                    });
                    // Dungeons
                    for (let i = 0; i < MICSR.dungeons.length; i++) {
                        if (!this.dungeonSimData[i]) {
                            return;
                        }
                        if (this.dungeonSimData[i].simSuccess) {
                            this.dungeonSimData[i].gpPerSecond = this.dungeonSimData[i].gpFromDamagePerSecond;
                            this.dungeonSimData[i].gpPerSecond += this.computeDungeonValue(i) / this.dungeonSimData[i].killTimeS;
                        }
                    }
                    // slayer tasks
                    for (let taskID = 0; taskID < this.slayerTaskMonsters.length; taskID++) {
                        this.setMonsterListAverageDropRate('gpPerSecond', this.slayerSimData[taskID], this.slayerTaskMonsters[taskID]);
                    }
                }
            }

            /**
             * Updates the amount of slayer xp earned when killing monsters
             */
            updateSlayerXP() {
                if (this.app.isViewingDungeon && this.app.viewedDungeonID < MICSR.dungeons.length) {
                    MICSR.dungeons[this.app.viewedDungeonID].monsters.forEach((monsterID) => {
                        if (!this.monsterSimData[monsterID]) {
                            return;
                        }
                        this.monsterSimData[monsterID].slayerXpPerSecond = 0;
                    });
                    return;
                }

                const updateMonsterSlayerXP = (monsterID) => {
                    if (!this.monsterSimData[monsterID]) {
                        return;
                    }
                    if (this.monsterSimData[monsterID].simSuccess && this.monsterSimData[monsterID].killTimeS) {
                        let monsterXP = 0;
                        monsterXP += (MONSTERS[monsterID].slayerXP !== undefined) ? MONSTERS[monsterID].slayerXP : 0;
                        if (this.currentSim.isSlayerTask) {
                            monsterXP += MONSTERS[monsterID].hitpoints;
                        }
                        this.monsterSimData[monsterID].slayerXpPerSecond = monsterXP * (1 + this.currentSim.playerStats.slayerXpBonus / 100) / this.monsterSimData[monsterID].killTimeS;
                    } else {
                        this.monsterSimData[monsterID].slayerXpPerSecond = 0;
                    }
                };

                // combat zones
                combatAreas.forEach(area => {
                    area.monsters.forEach(monsterID => updateMonsterSlayerXP(monsterID));
                });
                const bardID = 139;
                updateMonsterSlayerXP(bardID);
                // slayer areas
                slayerAreas.forEach((area) => {
                    area.monsters.forEach(monsterID => updateMonsterSlayerXP(monsterID));
                });
                // auto slayer
                for (let taskID = 0; taskID < this.slayerTaskMonsters.length; taskID++) {
                    this.setMonsterListAverageDropRate('slayerXpPerSecond', this.slayerSimData[taskID], this.slayerTaskMonsters[taskID]);
                }
            }

            /**
             * Updates the amount of slayer coins earned when killing monsters
             */
            updateSlayerCoins() {
                if (this.app.isViewingDungeon && this.app.viewedDungeonID < MICSR.dungeons.length) {
                    MICSR.dungeons[this.app.viewedDungeonID].monsters.forEach((monsterID) => {
                        if (!this.monsterSimData[monsterID]) {
                            return;
                        }
                        this.monsterSimData[monsterID].slayerCoinsPerSecond = this.monsterSimData[monsterID].scGainedPerSecond;
                    });
                    return;
                }

                const updateMonsterSlayerCoins = (monsterID, data) => {
                    if (!data) {
                        return;
                    }
                    data.slayerCoinsPerSecond = data.scGainedPerSecond;
                    if (!this.currentSim.isSlayerTask) {
                        return;
                    }
                    if (!data.simSuccess) {
                        return;
                    }
                    if (!data.killTimeS) {
                        return;
                    }
                    const sc = applyModifier(
                        MONSTERS[monsterID].hitpoints,
                        MICSR.getModifierValue(this.modifiers, 'SlayerCoins')
                    );
                    data.slayerCoinsPerSecond += sc / data.killTimeS;
                };

                // combat zones
                combatAreas.forEach(area => {
                    area.monsters.forEach(monsterID => updateMonsterSlayerCoins(monsterID, this.monsterSimData[monsterID]));
                });
                const bardID = 139;
                updateMonsterSlayerCoins(bardID, this.monsterSimData[bardID]);
                // slayer areas
                slayerAreas.forEach((area) => {
                    area.monsters.forEach(monsterID => updateMonsterSlayerCoins(monsterID, this.monsterSimData[monsterID]));
                });
                // dungeon
                for (let i = 0; i < MICSR.dungeons.length; i++) {
                    const monsterID = MICSR.dungeons[i].monsters[MICSR.dungeons[i].monsters.length - 1];
                    updateMonsterSlayerCoins(monsterID, this.dungeonSimData[i]);
                }
                // auto slayer
                for (let taskID = 0; taskID < this.slayerTaskMonsters.length; taskID++) {
                    this.setMonsterListAverageDropRate('slayerCoinsPerSecond', this.slayerSimData[taskID], this.slayerTaskMonsters[taskID]);
                }
            }

            /**
             * Updates the chance to receive your selected loot when killing monsters
             */
            updateDropChance() {
                if (this.app.isViewingDungeon && this.app.viewedDungeonID < MICSR.dungeons.length) {
                    MICSR.dungeons[this.app.viewedDungeonID].monsters.forEach((monsterID) => {
                        if (!this.monsterSimData[monsterID]) {
                            return;
                        }
                        this.monsterSimData[monsterID].updateDropChance = 0;
                    });
                } else {
                    const updateMonsterDropChance = (monsterID, data) => {
                        if (!data) {
                            return;
                        }
                        const dropCount = this.getAverageDropAmt(monsterID);
                        const itemDoubleChance = this.currentSim.lootBonus;
                        data.dropChance = (dropCount * itemDoubleChance) / data.killTimeS;
                    };

                    // Set data for monsters in combat zones
                    combatAreas.forEach((area) => {
                        area.monsters.forEach(monsterID => updateMonsterDropChance(monsterID, this.monsterSimData[monsterID]));
                    });
                    const bardID = 139;
                    updateMonsterDropChance(bardID, this.monsterSimData[bardID]);
                    slayerAreas.forEach((area) => {
                        area.monsters.forEach(monsterID => updateMonsterDropChance(monsterID, this.monsterSimData[monsterID]));
                    });
                    // compute dungeon drop rates
                    for (let dungeonID = 0; dungeonID < MICSR.dungeons.length; dungeonID++) {
                        const monsterList = MICSR.dungeons[dungeonID].monsters;
                        if (godDungeonID.includes(dungeonID)) {
                            MICSR.dungeons[dungeonID].monsters.forEach(monsterID => {
                                updateMonsterDropChance(monsterID, this.monsterSimData[monsterID]);
                            });
                            this.setMonsterListAverageDropRate('dropChance', this.dungeonSimData[dungeonID], monsterList);
                        } else {
                            const monsterID = monsterList[monsterList.length - 1];
                            updateMonsterDropChance(monsterID, this.dungeonSimData[dungeonID]);
                        }
                    }
                    // compute auto slayer drop rates
                    for (let taskID = 0; taskID < this.slayerTaskMonsters.length; taskID++) {
                        this.setMonsterListAverageDropRate('dropChance', this.slayerSimData[taskID], this.slayerTaskMonsters[taskID]);
                    }
                }
            }

            setMonsterListAverageDropRate(property, simData, monsterList) {
                if (!simData) {
                    return;
                }
                let drops = 0;
                let killTime = 0;
                for (const monsterID of monsterList) {
                    if (!this.monsterSimData[monsterID]) {
                        return;
                    }
                    drops += this.monsterSimData[monsterID][property] * this.monsterSimData[monsterID].killTimeS;
                    killTime += this.monsterSimData[monsterID].killTimeS;
                }
                simData[property] = drops / killTime;
            }

            addChestLoot(chestID, chestChance, chestAmt) {
                const dropTable = items[chestID].dropTable;
                let chestItemChance = 0;
                let chestItemAmt = 0;
                if (dropTable) {
                    const chestSum = dropTable.reduce((acc, x) => acc + x[1], 0);
                    dropTable.forEach((x, i) => {
                        const chestItemId = x[0];
                        if (chestItemId === this.app.combatData.dropSelected) {
                            const weight = x[1];
                            chestItemChance += chestAmt * chestChance * weight / chestSum;
                            chestItemAmt += items[chestID].dropQty[i];
                        }
                    });
                }
                return {
                    chance: chestItemChance,
                    amt: chestItemAmt,
                };
            }

            getAverageRegularDropAmt(monsterId) {
                let totalChances = 0;
                let selectedChance = 0;
                let selectedAmt = 0;
                const monsterData = MONSTERS[monsterId];
                if (!monsterData.lootTable) {
                    return 0;
                }
                monsterData.lootTable.forEach(drop => {
                    const itemId = drop[0];
                    const chance = drop[1];
                    totalChances += chance;
                    const amt = drop[2];
                    if (itemId === this.app.combatData.dropSelected) {
                        selectedChance += chance;
                        selectedAmt += amt;
                    }
                    const chest = this.addChestLoot(itemId, chance, amt);
                    selectedChance += chest.chance;
                    selectedAmt += chest.amt;
                })
                // compute drop rate based on monster loot chance, and drop table weights
                const lootChance = monsterData.lootChance ? monsterData.lootChance / 100 : 1;
                const dropRate = lootChance * selectedChance / totalChances;
                // On average, an item with up to `n` drops will drop `(n + 1) / 2` items
                const averageDropAmt = Math.max((selectedAmt + 1) / 2, 1);
                // multiply drop rate with drop amount
                return dropRate * averageDropAmt;
            }

            getAverageBoneDropAmt(monsterId) {
                const monsterData = MONSTERS[monsterId];
                const boneID = monsterData.bones;
                if (boneID === undefined || boneID === null) {
                    return 0;
                }
                const amt = monsterData.boneQty ? monsterData.boneQty : 1;
                if (boneID === this.app.combatData.dropSelected) {
                    return amt;
                }
                const upgradeID = items[boneID].trimmedItemID;
                if (upgradeID === undefined || upgradeID === null) {
                    return 0;
                }
                const upgradeCost = items[items[boneID].trimmedItemID].itemsRequired.filter(x => x[0] === boneID)[0][1];
                const upgradeAmt = amt;
                if (upgradeID === this.app.combatData.dropSelected) {
                    return upgradeAmt / upgradeCost;
                }
                const chest = this.addChestLoot(upgradeID, 1, upgradeAmt);
                // compute drop rate based on chest table weights
                const dropRate = chest.chance / upgradeCost;
                // On average, an item with up to `n` drops will drop `(n + 1) / 2` items
                const averageDropAmt = Math.max((chest.amt + 1) / 2, 1);
                // multiply drop rate with drop amount
                return dropRate * averageDropAmt;
            }

            getAverageDropAmt(monsterId) {
                let averageDropAmt = 0;
                // regular drops
                averageDropAmt += this.getAverageRegularDropAmt(monsterId);
                // bone drops
                averageDropAmt += this.getAverageBoneDropAmt(monsterId);
                return averageDropAmt;
            }

            /**
             * Updates the chance to receive signet when killing monsters
             */
            updateSignetChance() {
                if (this.app.isViewingDungeon && this.app.viewedDungeonID < MICSR.dungeons.length) {
                    MICSR.dungeons[this.app.viewedDungeonID].monsters.forEach((monsterID) => {
                        if (!this.monsterSimData[monsterID]) {
                            return;
                        }
                        this.monsterSimData[monsterID].signetChance = 0;
                    });
                } else {
                    const updateMonsterSignetChance = (monsterID, data) => {
                        if (!data) {
                            return;
                        }
                        if (this.currentSim.canTopazDrop && data.simSuccess) {
                            data.signetChance = (1 - Math.pow(1 - this.getSignetDropRate(monsterID), Math.floor(this.signetFarmTime * 3600 / data.killTimeS))) * 100;
                        } else {
                            data.signetChance = 0;
                        }
                    };
                    // Set data for monsters in combat zones
                    combatAreas.forEach((area) => {
                        area.monsters.forEach(monsterID => updateMonsterSignetChance(monsterID, this.monsterSimData[monsterID]));
                    });
                    const bardID = 139;
                    updateMonsterSignetChance(bardID, this.monsterSimData[bardID]);
                    slayerAreas.forEach((area) => {
                        area.monsters.forEach(monsterID => updateMonsterSignetChance(monsterID, this.monsterSimData[monsterID]));
                    });
                    for (let i = 0; i < MICSR.dungeons.length; i++) {
                        const monsterID = MICSR.dungeons[i].monsters[MICSR.dungeons[i].monsters.length - 1];
                        updateMonsterSignetChance(monsterID, this.dungeonSimData[i]);
                    }
                    for (let i = 0; i < this.slayerTaskMonsters.length; i++) {
                        // TODO: signet rolls for auto slayer
                        this.slayerSimData[i].signetChance = undefined;
                    }
                }
            }

            /**
             * Calculates the drop chance of a signet half from a monster
             * @param {number} monsterID The index of MONSTERS
             * @return {number}
             */
            getSignetDropRate(monsterID) {
                return MICSR.getMonsterCombatLevel(monsterID) * this.computeLootChance(monsterID) / 500000;
            }

            /** Updates the chance to get a pet for the given skill*/
            updatePetChance() {
                const petSkills = ['Hitpoints', 'Prayer'];
                if (this.currentSim.isSlayerTask) {
                    petSkills.push('Slayer');
                }
                if (!this.currentSim.playerStats) {
                    return;
                }

                const attackType = this.currentSim.playerStats.attackType;
                switch (attackType) {
                    case CONSTANTS.attackType.Melee:
                        switch (this.currentSim.attackStyle.Melee) {
                            case 0:
                                petSkills.push('Attack');
                                break;
                            case 1:
                                petSkills.push('Strength');
                                break;
                            case 2:
                                petSkills.push('Defence');
                                break;
                        }
                        break;
                    case CONSTANTS.attackType.Ranged:
                        petSkills.push('Ranged');
                        if (this.currentSim.attackStyle.Ranged === 2) petSkills.push('Defence');
                        break;
                    case CONSTANTS.attackType.Magic:
                        petSkills.push('Magic');
                        if (this.currentSim.attackStyle.Magic === 1) petSkills.push('Defence');
                        break;
                }
                if (petSkills.includes(this.petSkill)) {
                    const petSkillLevel = this.currentSim.virtualLevels[this.petSkill] + 1;
                    this.monsterSimData.forEach((simResult) => {
                        if (!simResult.simSuccess) {
                            simResult.petChance = 0;
                            return;
                        }
                        const timePeriod = (this.app.timeMultiplier === -1) ? simResult.killTimeS : this.app.timeMultiplier;
                        const petRolls = simResult.petRolls[this.petSkill] || simResult.petRolls.other;
                        simResult.petChance = 1 - petRolls.reduce((chanceToNotGet, petRoll) => {
                            return chanceToNotGet * Math.pow((1 - petRoll.speed * petSkillLevel / 25000000000), timePeriod * petRoll.rollsPerSecond);
                        }, 1);
                        simResult.petChance *= 100;
                    });
                    MICSR.dungeons.forEach((_, dungeonId) => {
                        const dungeonResult = this.dungeonSimData[dungeonId];
                        if (!dungeonResult.simSuccess || this.petSkill === 'Slayer') {
                            dungeonResult.petChance = 0;
                            return;
                        }
                        const timePeriod = (this.app.timeMultiplier === -1) ? dungeonResult.killTimeS : this.app.timeMultiplier;
                        dungeonResult.petChance = 1 - MICSR.dungeons[dungeonId].monsters.reduce((cumChanceToNotGet, monsterID) => {
                            const monsterResult = this.monsterSimData[monsterID];
                            const timeRatio = monsterResult.killTimeS / dungeonResult.killTimeS;
                            const petRolls = monsterResult.petRolls[this.petSkill] || monsterResult.petRolls.other;
                            const monsterChanceToNotGet = petRolls.reduce((chanceToNotGet, petRoll) => {
                                return chanceToNotGet * Math.pow((1 - petRoll.speed * petSkillLevel / 25000000000), timePeriod * timeRatio * petRoll.rollsPerSecond);
                            }, 1);
                            return cumChanceToNotGet * monsterChanceToNotGet;
                        }, 1);
                        dungeonResult.petChance *= 100;
                    });
                    // TODO: pet rolls for auto slayer
                } else {
                    this.monsterSimData.forEach((simResult) => {
                        simResult.petChance = 0;
                    });
                    this.dungeonSimData.forEach((simResult) => {
                        simResult.petChance = 0;
                    });
                    this.slayerSimData.forEach((simResult) => {
                        simResult.petChance = 0;
                    });
                }
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
    waitLoadOrder(reqs, setup, 'Loot');

})();