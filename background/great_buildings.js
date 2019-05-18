greatBuilding = {
  requestId: -1,
  requiredFP: 0,
  ownerId: -1,
  arcBonus: 0,
  process: function (method, data, id) {
    if (trace) {
      console.log('GreatBuildingsService.' + method, data);
    }
    switch (method) {
      case 'getConstruction':
        if (greatBuilding.requestId != id) {
          console.error('Wrong id ' + id + ', expected ' + greatBuilding.requestId);
          return;
        }

        gbFpAnalysis = greatBuilding.performAnalysis(data.rankings);

        if (debug) {
          console.log(gbFpAnalysis);
        }

        sendMessageCache({ gbFpAnalysis: gbFpAnalysis });
        break;
      case 'getOtherPlayerOverview':
        greatBuilding.checkGBChanges(data, function (changes) {
          if (debug) {
            console.log('playerGBChanges', changes);
          }

          sendMessageCache({ playerGBChanges: changes });
        });
        break;
      default:
        if (trace || debug) {
          console.log('GreatBuildingsService.' + method + ' is not used');
        }
    }
  },
  performAnalysis: function (dataRankings) {
    investedFP = 0;
    userFP = 0;
    userIndex = undefined;
    ownerFP = 0;
    ownerIndex = undefined;

    // Remove player from rankings as this messes the calculations
    // (it is an investment that is already done on behalf of the player)
    rankings = [];
    for (var i = 0; i < dataRankings.length; i++) {
      ranking = Object.assign({}, dataRankings[i]);
      rankings.push(ranking);
      if (userIndex !== undefined) {
        // Move all other investments one up, to remove the player investment
        rankings[i - 1].forge_points = rankings[i].forge_points;
        rankings[i].forge_points == undefined;
      }

      if (ranking.forge_points) {
        if (ranking.player.player_id == greatBuilding.ownerId) {
          ownerIndex = i
          ownerFP = ranking.forge_points;
        }
        if (ranking.player.is_self) {
          userIndex = i;
          userFP = ranking.forge_points;
        }
        if (ranking.player.player_id != greatBuilding.ownerId && !ranking.player.is_self) {
          // Only count non-player investments
          investedFP += ranking.forge_points;
        }
      }
    }
    if (userIndex !== undefined) {
      // Remove last investment, as they all moved up by one
      rankings[rankings.length - 1].forge_points = undefined;
    }
    freeFP = (greatBuilding.requiredFP - investedFP - ownerFP);

    if (debug) {
      console.log('free FP (excluding player and owner): ' + freeFP);
      console.log('user (#' + (userIndex + 1) + '): ' + userFP);
      console.log('owner (#' + (ownerIndex + 1) + '): ' + ownerFP);
    }

    var fpAnalysis = [];
    var rank = 0;
    var i = -1;
    while (rank <= 5 && i < rankings.length - 1) {
      i++;
      ranking = rankings[i];
      if (ranking.reward === undefined || ranking.player.player_id == greatBuilding.ownerId) {
        // Probably (hopefully) owner
        continue;
      }
      rank = ranking.rank;

      var investedByOthers = 0;
      var bestSpotFP = greatBuilding.requiredFP;
      var j = i + 1;
      while (j >= 1) {
        j--;
        if (rankings[j].reward === undefined || rankings[j].player.player_id == greatBuilding.ownerId) {
          // Probably (hopefully) owner
          continue;
        }

        investedByOthers += (rankings[j].forge_points || 0);
        tmp = Math.ceil((freeFP + investedByOthers + j - i) / (i - j + 2));
        if (tmp <= rankings[j].forge_points) {
          tmp = rankings[j].forge_points + 1;
        }
        if (tmp < bestSpotFP) {
          bestSpotFP = tmp;
        }
      }

      if ((userIndex !== undefined && userIndex == ownerIndex) || bestSpotFP > freeFP || bestSpotFP < userFP || bestSpotFP === 0) {
        // Used for Boost information
        fpAnalysis.push({
          spotSafe: false,
          reward: {
            fp: ranking.reward.strategy_point_amount,
            fpBonus: Math.round(fixFloat(ranking.reward.strategy_point_amount * greatBuilding.arcBonus)),
            blueprints: ranking.reward.blueprints,
            blueprintsBonus: Math.round(fixFloat(ranking.reward.blueprints * greatBuilding.arcBonus)),
            medals: ranking.reward.resources.medals,
            medalsBonus: Math.round(fixFloat(ranking.reward.resources.medals * greatBuilding.arcBonus))
          }
        });
        continue;
      }

      profit = Math.round(fixFloat((ranking.reward.strategy_point_amount || 0) * (1 + greatBuilding.arcBonus) - bestSpotFP));

      // Used for both Boost and GB information
      fpAnalysis.push({
        spotSafe: bestSpotFP,
        profit: profit,
        reward: {
          fp: ranking.reward.strategy_point_amount,
          fpBonus: Math.round(fixFloat(ranking.reward.strategy_point_amount * greatBuilding.arcBonus)),
          blueprints: ranking.reward.blueprints,
          blueprintsBonus: Math.round(fixFloat(ranking.reward.blueprints * greatBuilding.arcBonus)),
          medals: ranking.reward.resources.medals,
          medalsBonus: Math.round(fixFloat(ranking.reward.resources.medals * greatBuilding.arcBonus))
        }
      });
    }

    // Add investments for all rankings (if available)
    ranking = 0
    for (var i = 0; i < rankings.length; i++) {
      if (rankings[i].forge_points === undefined || (rankings[i].player.player_id == greatBuilding.ownerId && !rankings[i].player.is_self)) {
        // Don't store SP for owner (unless it is player, as the SPs are shifted after player)
        continue;
      }
      if (fpAnalysis.length > ranking) {
        fpAnalysis[ranking].invested = rankings[i].forge_points;
      } else {
        fpAnalysis.push({ invested: rankings[i].forge_points });
      }
      ranking++;
    }
    return {
      totalFP: greatBuilding.requiredFP,
      freeFP: freeFP - userFP,
      analysis: fpAnalysis,
    };
  },
  checkGBChanges: function (data, resultCallback) {
    if (data.length == 0) {
      // Nothing to do
      return resultCallback({ player: '', changes: [] });
    }
    var playerId = data[0].player.player_id;
    syncGet({ 'playerGBs': {} }, function (result) {
      playerGB = (result.playerGBs[playerId]) || {};
      changes = [];
      now = Date.now() / 1000;
      for (var i = 0; i < data.length; i++) {
        if (playerGB[data[i].city_entity_id] === undefined || playerGB[data[i].city_entity_id].last_spent != data[i].last_spent || data[i].last_spent + 2 * 24 * 3600 > now) {
          changes.push({
            name: data[i].name,
            last_spent: data[i].last_spent,
            completePercentage: parseFloat((data[i].current_progress || 0) / data[i].max_progress * 100).toPrecision(3)
          });
        }
      }

      if (changes.length == 0) {
        changes = [{
          name: 'last change',
          last_spent: data[0].last_spent
        }];
      }

      newPlayerGB = {
        lastAccess: Date.now()
      };
      for (var i = 0; i < data.length; i++) {
        GBentry = playerGB[data[i].city_entity_id] || {};
        GBentry.last_spent = data[i].last_spent,
          GBentry.level = data[i].level,
          GBentry.current_progress = data[i].current_progress;

        newPlayerGB[data[i].city_entity_id] = GBentry;
      }
      result.playerGBs[playerId] = newPlayerGB;
      syncSet({ 'playerGBs': result.playerGBs });

      resultCallback({ player: data[0].player.name, changes: changes });
    });
  },
  storeBuildingInfo: function (requestId, ownerId, requiredFP) {
    greatBuilding.requestId = requestId;
    greatBuilding.ownerId = ownerId;
    greatBuilding.requiredFP = requiredFP;
  },
  checkArcBonus: function (entities) {
    // Check for Arc bonus as we need it for our calculations
    for (var i = 0; i < entities.length; i++) {
      if (entities[i].cityentity_id === 'X_FutureEra_Landmark1' && entities[i].player_id == startup.playerId) {
        if (debug) {
          console.log('Arc', entities[i]);
        }
        greatBuilding.setArcBonus(entities[i].bonus.value);
      }
    }
  },
  setArcBonus: function (bonus) {
    bonus = fixFloat(bonus / 100);
    greatBuilding.arcBonus = bonus;
    syncSet({ 'arcBonus': bonus });
    if (debug) {
      console.log('arc bonus: ', greatBuilding.arcBonus);
    }
  }
};

listenToWorldIDChanged(function () {
  syncGet({ 'arcBonus': 0 }, function (result) {
    greatBuilding.arcBonus = parseFloat(result.arcBonus);
    if (debug) {
      console.log('arc bonus: ', greatBuilding.arcBonus);
    }
  });
});
