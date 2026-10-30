export interface DisplayModeInput {
  navigatorStandalone?: boolean;
  displayStandalone?: boolean;
  displayFullscreen?: boolean;
}

export function computeStandaloneMode(input: DisplayModeInput): boolean {
  return Boolean(
    input.navigatorStandalone ||
    input.displayStandalone ||
    input.displayFullscreen
  );
}

export function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const mm = window.matchMedia?.bind(window);
  return computeStandaloneMode({
    navigatorStandalone: nav.standalone === true,
    displayStandalone: mm?.('(display-mode: standalone)').matches === true,
    displayFullscreen: mm?.('(display-mode: fullscreen)').matches === true,
  });
}
