import { WorldExplorerLayer, DEFAULT_SETTINGS } from "./world-explorer-layer.mjs";

Hooks.on("init", async () => {
    const defaultSceneConfigRender = SceneConfig.prototype._renderInner;
    SceneConfig.prototype._renderInner = async function(...args) {
        const $html = await defaultSceneConfigRender.apply(this, args);
        const settings = mergeObject(DEFAULT_SETTINGS, this.entity.data.flags["world-explorer"]);
        const templateName = "modules/world-explorer/templates/scene-settings.html";
        const template = await renderTemplate(templateName, settings);
        $html.find("button[type='submit']").before(template);
        return $html;
    };
})

Hooks.on("canvasInit", () => {
    canvas.worldExplorer = new WorldExplorerLayer();
    canvas.stage.addChild(canvas.worldExplorer);

    // Add world explorer layer to be right after the background
    const canvasLayers = Canvas.layers;
    const layers = {};
    for (const [key, value] of Object.entries(canvasLayers)) {
        layers[key] = value;
        if (key === "background") {
            layers.worldExplorer = canvas.worldExplorer;
        }
    }

    Object.defineProperty(Canvas, "layers", { get: () => layers });
});

Hooks.on("canvasReady", () => {
    canvas.worldExplorer?.ready();
});

Hooks.on("createToken", (token) => {
    if (token.object?.observer) {
        canvas.worldExplorer?.refreshMask();
        persistRevealedArea(token);
    }
});

Hooks.on("updateToken", (token, data) => {
    if (!token.object?.observer) return;
    if (data.x || data.y) {
        canvas.worldExplorer?.refreshMask();
        persistRevealedArea(token);
    }
});

Hooks.on("deleteToken", () => {
    canvas.worldExplorer?.refreshMask();
});

Hooks.on("updateScene", (scene, data) => {
    if (scene.id !== canvas.scene.id) return;
    if (data.flags && "world-explorer" in data.flags) {
        canvas.worldExplorer?.update(scene);
    }
});

// Add Controls
Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    // note: trying to check the active scene to early exit will prevent activeTool from functioning
    // Find another way to "disable" the scene control buttons

    controls.push({
        name: "world-explorer",
        title: game.i18n.localize("WorldExplorer.Name"),
        icon: "fas fa-map",
        layer: "worldExplorer",
        tools: [
            {
                name: "toggle",
                title: game.i18n.localize("WorldExplorer.Tools.Toggle"),
                icon: "fas fa-random",
            },
        ],
        activeTool: "toggle",
    });
});

// Handle Control Changes

Hooks.on('renderSceneControls', (controls) => {
    if (!canvas.worldExplorer) return;

    const isExplorer = controls.activeControl === "world-explorer";
    canvas.worldExplorer.editing = isExplorer && controls.activeTool === "toggle";
});

function persistRevealedArea(token) {
    if (!game.user.isGM || !canvas.worldExplorer?.settings.persistExploredAreas) return;
    
    // Computing token's center is required to not reveal an area to the token's left upon token's creation.
    // This happened on "Hexagonal Rows - Odd" grid configuration during token creation. Using center works
    // on every grid configuration afaik.
    const center = {
        x: token.data.x + ((token.parent?.dimensions?.size / 2) ?? 0),
        y: token.data.y + ((token.parent?.dimensions?.size / 2) ?? 0),
    };
    canvas.worldExplorer?.reveal(center.x, center.y);
}