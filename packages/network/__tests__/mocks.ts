export interface NetworkInformationMock extends EventTarget {
  effectiveType: string;
  downlink: number;
  rtt: number;
  saveData: boolean;
  /** Update fields and dispatch a `change` event, as the real API does. */
  change: (partial: Partial<Pick<NetworkInformationMock, "effectiveType" | "downlink" | "rtt" | "saveData">>) => void;
}

const DEFAULTS = {
  effectiveType: "4g",
  downlink: 10,
  rtt: 50,
  saveData: false,
};

/** Build a controllable NetworkInformation-like object. */
export function makeNetworkInformation(initial: Partial<typeof DEFAULTS> = {}): NetworkInformationMock {
  const conn = new EventTarget() as NetworkInformationMock;
  Object.assign(conn, DEFAULTS, initial);
  conn.change = (partial) => {
    Object.assign(conn, partial);
    conn.dispatchEvent(new Event("change"));
  };
  return conn;
}

/** Install navigator.connection as a controllable fake. Returns the fake for inspection/mutation. */
export function installConnection(initial: Partial<typeof DEFAULTS> = {}): NetworkInformationMock {
  const conn = makeNetworkInformation(initial);
  Object.defineProperty(navigator, "connection", {
    value: conn,
    configurable: true,
    writable: true,
  });
  return conn;
}

/** Remove navigator.connection so the "unsupported" branch can be tested. */
export function removeConnection(): void {
  Object.defineProperty(navigator, "connection", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}
