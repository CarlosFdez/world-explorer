import PixiJS from "pixi.js";

declare global {
    type EditingMode = "toggle" | "reveal" | "hide";

    type CoordsOrOffset = { offset?: unknown; coords?: unknown };
    type Position = "back" | "behindDrawings" | "behindTokens" | "front";

    interface GridEntry {
        offset: { i: number; j: number; };
        reveal: boolean | "partial";
    }

    interface WorldExplorerFlags {
        color: string;
        opacityGM: number;
        opacityPlayer: number;
        persistExploredAreas: boolean;
        image?: string;
        enabled?: boolean;
        zIndex: number;
        gridData?: Record<string, GridEntry | undefined>;
        position: Position;
        tokenReveal: {
            units: "grid" | "spaces";
            value: number | null;
        };
        gridReveal: {
            units: "grid" | "spaces";
            value: number;
        };
    }

    interface WorldExplorerState {
        clearing: boolean;
        tool: EditingMode;
    }

    namespace globalThis {
        export import PIXI = PixiJS;
    }
}