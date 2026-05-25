import { world } from "@minecraft/server";

world.afterEvents.itemUse.subscribe((event) => {
    if (event.itemStack.typeId === "minecraft:stick") {
        event.source.sendMessage("§a[Sistema] Pong! A Scripting API está viva. Você balançou um graveto.");
    }
});