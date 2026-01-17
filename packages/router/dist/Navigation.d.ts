export type NavigationLike = {
    navigate?: (url: string) => void;
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
};
export declare function getNavigation(): NavigationLike | null;
//# sourceMappingURL=Navigation.d.ts.map