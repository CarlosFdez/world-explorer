import { BackgroundOverlay } from "./background-overlay.mjs"

Hooks.on("canvasInit", () => {
    canvas.background.explorationOverlay = new BackgroundOverlay(canvas.scene);
});

Hooks.on("canvasReady", () => {
    canvas.background.explorationOverlay.ready();
});

Hooks.on("createToken", (token) => {
    if (token.object.observer) canvas.background.explorationOverlay?.refreshMask();
});

Hooks.on("updateToken", (token, data) => {
    if (!token.object.observer) return;
    if (data.x || data.y) {
        canvas.background.explorationOverlay?.refreshMask();
    }
});

Hooks.on("deleteToken", () => {
    canvas.background.explorationOverlay?.refreshMask();
});

Hooks.on("updateScene", (scene, data) => {
    if (data.flags && "world-explorer" in data.flags) {
        canvas.background.explorationOverlay?.refreshMask();
    }
})