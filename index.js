import { BackgroundOverlay } from "./background-overlay.mjs"

Hooks.on("init", async () => {
    const defaultSceneConfigRender = SceneConfig.prototype._renderInner;
    SceneConfig.prototype._renderInner = async function(...args) {
        const $html = await defaultSceneConfigRender.apply(this, args);
        const settings = this.entity.data.flags["world-explorer"];
        const templateName = "modules/world-explorer/templates/scene-settings.html";
        const template = await renderTemplate(templateName, settings);
        $html.find("button[type='submit']").before(template);
        return $html;
    };
})

Hooks.on("canvasInit", () => {
    canvas.background.explorationOverlay = new BackgroundOverlay(canvas.scene);
});

Hooks.on("canvasReady", () => {
    canvas.background.explorationOverlay?.ready();
});

Hooks.on("createToken", (token) => {
    if (token.object?.observer) canvas.background.explorationOverlay?.refreshMask();
});

Hooks.on("updateToken", (token, data) => {
    if (!token.object?.observer) return;
    if (data.x || data.y) {
        canvas.background.explorationOverlay?.refreshMask();
    }
});

Hooks.on("deleteToken", () => {
    canvas.background.explorationOverlay?.refreshMask();
});

Hooks.on("updateScene", (scene, data) => {
    if (scene.id !== canvas.scene.id) return;
    if (data.flags && "world-explorer" in data.flags) {
        canvas.background.explorationOverlay?.update(scene);
    }
});