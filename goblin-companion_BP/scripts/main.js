import { world, system, ItemStack, Direction } from "@minecraft/server";

const ORE_DATA = {
    "minecraft:coal_ore":                  { drop: "minecraft:coal",         tier: 0, xp: 1 },
    "minecraft:deepslate_coal_ore":        { drop: "minecraft:coal",         tier: 0, xp: 1 },
    "minecraft:copper_ore":                { drop: "minecraft:raw_copper",   tier: 0, xp: 0 },
    "minecraft:deepslate_copper_ore":      { drop: "minecraft:raw_copper",   tier: 0, xp: 0 },
    "minecraft:iron_ore":                  { drop: "minecraft:raw_iron",     tier: 1, xp: 0 },
    "minecraft:deepslate_iron_ore":        { drop: "minecraft:raw_iron",     tier: 1, xp: 0 },
    "minecraft:lapis_ore":                 { drop: "minecraft:lapis_lazuli", tier: 1, xp: 3 },
    "minecraft:deepslate_lapis_ore":       { drop: "minecraft:lapis_lazuli", tier: 1, xp: 3 },
    "minecraft:gold_ore":                  { drop: "minecraft:raw_gold",     tier: 2, xp: 0 },
    "minecraft:deepslate_gold_ore":        { drop: "minecraft:raw_gold",     tier: 2, xp: 0 },
    "minecraft:diamond_ore":               { drop: "minecraft:diamond",      tier: 2, xp: 4 },
    "minecraft:deepslate_diamond_ore":     { drop: "minecraft:diamond",      tier: 2, xp: 4 },
    "minecraft:emerald_ore":               { drop: "minecraft:emerald",      tier: 2, xp: 4 },
    "minecraft:deepslate_emerald_ore":     { drop: "minecraft:emerald",      tier: 2, xp: 4 },
    "minecraft:redstone_ore":              { drop: "minecraft:redstone",     tier: 2, xp: 3 },
    "minecraft:deepslate_redstone_ore":    { drop: "minecraft:redstone",     tier: 2, xp: 3 },
    "minecraft:lit_redstone_ore":          { drop: "minecraft:redstone",     tier: 2, xp: 3 },
    "minecraft:lit_deepslate_redstone_ore":{ drop: "minecraft:redstone",     tier: 2, xp: 3 }
};

const PICKAXE_TIERS = {
    "minecraft:wooden_pickaxe":    { tier: 0, speed: 40 },
    "minecraft:golden_pickaxe":    { tier: 0, speed: 10 },
    "minecraft:stone_pickaxe":     { tier: 1, speed: 30 },
    "minecraft:iron_pickaxe":      { tier: 2, speed: 20 },
    "minecraft:diamond_pickaxe":   { tier: 3, speed: 10 },
    "minecraft:netherite_pickaxe": { tier: 3, speed: 8  }
};

// Offsets por face usando o enum Direction (evita comparação frágil de string)
const FACE_OFFSETS = {
    [Direction.Up]:    { x:  0, y:  1, z:  0 },
    [Direction.Down]:  { x:  0, y: -1, z:  0 },
    [Direction.North]: { x:  0, y:  0, z: -1 },
    [Direction.South]: { x:  0, y:  0, z:  1 },
    [Direction.East]:  { x:  1, y:  0, z:  0 },
    [Direction.West]:  { x: -1, y:  0, z:  0 }
};

function getDistance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function getFaceSpawnLoc(blockLoc, face) {
    const off = FACE_OFFSETS[face] ?? { x: 0, y: 0, z: 0 };
    return { x: blockLoc.x + off.x + 0.5, y: blockLoc.y + off.y, z: blockLoc.z + off.z + 0.5 };
}

// ── Estado do goblin ──────────────────────────────────────────────────────────

function setFollowState(goblin) {
    goblin.removeTag("is_sitting");
    goblin.triggerEvent("gcompanion:command_follow");
    goblin.dimension.playSound("goblin_trader_idle", goblin.location);
}

function setSitState(goblin) {
    goblin.addTag("is_sitting");
    goblin.triggerEvent("gcompanion:command_sit");
    goblin.dimension.playSound("goblin_trader_annoyed", goblin.location);
}

function playRejectionFeedback(goblin) {
    goblin.dimension.playSound("goblin_trader_annoyed", goblin.location);
}

function restoreState(goblin, wasSitting, originalLocation) {
    if (!goblin.isValid()) return;
    if (wasSitting && originalLocation) {
        pathfindWithDummy(goblin, originalLocation, () => setSitState(goblin), () => setSitState(goblin));
    } else {
        setFollowState(goblin);
    }
}

// ── Pathfinding unificado via dummy ───────────────────────────────────────────

function pathfindWithDummy(goblin, targetLoc, onArrived, onTimeout, arrivalDist = 3.5, maxTicks = 200) {
    const dim = goblin.dimension;
    const dummy = dim.spawnEntity("gcompanion:dummy", targetLoc);
    goblin.triggerEvent("gcompanion:command_go_to_ore");

    let ticks = 0;
    const runId = system.runInterval(() => {
        ticks++;

        if (!goblin.isValid() || !dummy.isValid()) {
            system.clearRun(runId);
            if (dummy.isValid()) dummy.remove();
            return;
        }

        if (getDistance(goblin.location, dummy.location) <= arrivalDist) {
            system.clearRun(runId);
            dummy.remove();
            onArrived();
            return;
        }

        if (ticks >= maxTicks) {
            system.clearRun(runId);
            dummy.remove();
            onTimeout();
        }
    }, 1);
}

// ── Eventos de input ──────────────────────────────────────────────────────────

let lastItemUseOnTick = -10;

world.afterEvents.itemUseOn.subscribe((event) => {
    if (event.itemStack?.typeId !== "minecraft:stick") return;
    lastItemUseOnTick = system.currentTick;

    if (ORE_DATA[event.block.typeId]) {
        processMiningCommand(event.source, event.block, event.blockFace);
    } else {
        toggleGoblinState(event.source);
    }
});

world.afterEvents.itemUse.subscribe((event) => {
    if (event.itemStack?.typeId !== "minecraft:stick") return;
    if (system.currentTick - lastItemUseOnTick <= 2) return;

    const raycast = event.source.getBlockFromViewDirection({ maxDistance: 7 });
    if (raycast?.block && ORE_DATA[raycast.block.typeId]) {
        processMiningCommand(event.source, raycast.block, raycast.face);
    } else {
        toggleGoblinState(event.source);
    }
});

// ── Lógica principal ──────────────────────────────────────────────────────────

function toggleGoblinState(player) {
    const goblins = player.dimension.getEntities({ type: "gcompanion:goblin", location: player.location, maxDistance: 15 });
    if (goblins.length === 0) return;

    const goblin = goblins[0];
    if (goblin.hasTag("is_sitting")) setFollowState(goblin);
    else setSitState(goblin);
}

function processMiningCommand(player, startBlock, blockFace) {
    const goblins = player.dimension.getEntities({ type: "gcompanion:goblin", location: player.location, maxDistance: 15 });
    if (goblins.length === 0) return;

    const goblin = goblins[0];
    if (!goblin.hasComponent("minecraft:inventory")) return;

    const container = goblin.getComponent("minecraft:inventory").container;
    const toolStack = container.getItem(0);

    if (!toolStack || !(toolStack.typeId in PICKAXE_TIERS)) { playRejectionFeedback(goblin); return; }

    const pickaxeData = PICKAXE_TIERS[toolStack.typeId];
    const oreInfo = ORE_DATA[startBlock.typeId];

    if (pickaxeData.tier < oreInfo.tier) { playRejectionFeedback(goblin); return; }

    const originalLocation = { ...goblin.location };
    const wasSitting = goblin.hasTag("is_sitting");
    if (wasSitting) goblin.removeTag("is_sitting");

    player.dimension.playSound("random.click", player.location);

    const dummyLoc = getFaceSpawnLoc(startBlock.location, blockFace);

    pathfindWithDummy(goblin, dummyLoc,
        () => {
            // Chegou: faz olhar pro minério, senta e começa a minerar
            const lookAt = { x: startBlock.location.x + 0.5, y: startBlock.location.y + 0.5, z: startBlock.location.z + 0.5 };
            try { goblin.teleport(goblin.location, { facingLocation: lookAt }); } catch (_) {}
            goblin.addTag("is_sitting");
            goblin.triggerEvent("gcompanion:command_sit");
            mineVein(goblin, container, toolStack, startBlock, startBlock.typeId, oreInfo, pickaxeData, wasSitting, originalLocation);
        },
        () => {
            // Timeout
            playRejectionFeedback(goblin);
            restoreState(goblin, wasSitting, originalLocation);
        }
    );
}

// ── Mineração ─────────────────────────────────────────────────────────────────

function mineVein(goblin, container, toolStack, startBlock, targetTypeId, oreInfo, pickaxeData, wasSitting, originalLocation) {
    const dim = goblin.dimension;
    const queue = [{ ...startBlock.location }];
    const visited = new Set([`${startBlock.location.x},${startBlock.location.y},${startBlock.location.z}`]);
    const MAX_BLOCKS = 24;

    let blocksMined = 0;
    let tickCounter = 0;

    const runId = system.runInterval(() => {
        if (!goblin.isValid()) { system.clearRun(runId); return; }

        tickCounter++;
        if (tickCounter < pickaxeData.speed) return;
        tickCounter = 0;

        if (queue.length === 0 || blocksMined >= MAX_BLOCKS) {
            system.clearRun(runId);
            restoreState(goblin, wasSitting, originalLocation);
            return;
        }

        const loc = queue.shift();
        let block;
        try { block = dim.getBlock(loc); } catch (_) { return; }
        if (!block || block.typeId !== targetTypeId) return;

        dim.playSound("dig.stone", loc);
        dim.playSound("step.stone", loc);
        block.setType("minecraft:air");

        const remainder = container.addItem(new ItemStack(oreInfo.drop, 1));
        if (remainder) dim.spawnItem(remainder, goblin.location);

        for (let i = 0; i < oreInfo.xp; i++) dim.spawnEntity("minecraft:xp_orb", loc);

        blocksMined++;

        const durability = toolStack.getComponent("durability");
        if (durability) {
            durability.damage += 1;
            if (durability.damage >= durability.maxDurability) {
                container.setItem(0, undefined);
                system.clearRun(runId);
                dim.playSound("random.break", goblin.location);
                playRejectionFeedback(goblin);
                restoreState(goblin, wasSitting, originalLocation);
                return;
            }
            container.setItem(0, toolStack);
        }

        // BFS ortogonal (6 faces) — mais fiel a veios reais do que os 26 vizinhos diagonais originais
        for (const off of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
            const nx = loc.x + off[0], ny = loc.y + off[1], nz = loc.z + off[2];
            const key = `${nx},${ny},${nz}`;
            if (visited.has(key)) continue;
            visited.add(key);
            try {
                const n = dim.getBlock({ x: nx, y: ny, z: nz });
                if (n?.typeId === targetTypeId) queue.push({ x: nx, y: ny, z: nz });
            } catch (_) {}
        }
    }, 1);
}