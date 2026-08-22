/**
 * builtinTags.generated.ts — 自動生成。手で編集しない。
 *
 * 生成: scripts/emit-builtin-tags.mjs（各 I/O パッケージの `static wcBindable` が単一正本）。
 * 再生成: npm run emit:builtin-tags
 */

/** 組み込み wcs-* タグ 1 つ分の wc-bindable 契約。 */
export interface BuiltinTagContract {
  /** 由来パッケージ（packages/<name>）。 */
  readonly package: string;
  /**
   * `static wcBindable` を宣言しているか。false はヘルパータグ
   * （wcs-fetch-header 等）— 空の契約（wcs-noise）と区別する。無宣言タグへの
   * spread はランタイム（expandSpread）が raiseError する。
   */
  readonly hasWcBindable: boolean;
  /** Shell の static observedAttributes（HTML 属性面。wcBindable とは別軸）。 */
  readonly observedAttributes: readonly string[];
  /** input 名 → ミラー属性名（属性ミラーなしは null）。 */
  readonly inputs: Readonly<Record<string, string | null>>;
  /** observable property（出力）名。 */
  readonly properties: readonly string[];
  /** command 名。 */
  readonly commands: readonly string[];
}

export const BUILTIN_TAGS: Readonly<Record<string, BuiltinTagContract>> = {
  "wcs-accelerometer": {
    "package": "accelerometer",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "frequency": null
    },
    "properties": [
      "x",
      "y",
      "z",
      "error",
      "errorInfo"
    ],
    "commands": [
      "start",
      "stop"
    ]
  },
  "wcs-ambient-light-sensor": {
    "package": "ambient-light-sensor",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "frequency": null
    },
    "properties": [
      "illuminance",
      "error",
      "errorInfo"
    ],
    "commands": [
      "start",
      "stop"
    ]
  },
  "wcs-audio": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "volume",
      "limiter",
      "resume-on-gesture"
    ],
    "inputs": {
      "volume": "volume",
      "limiter": "limiter",
      "resumeOnGesture": "resume-on-gesture"
    },
    "properties": [
      "state",
      "running",
      "suspended",
      "unsupported",
      "voices",
      "noteOn",
      "noteOff",
      "warnings",
      "error",
      "errorInfo"
    ],
    "commands": [
      "resume",
      "suspend",
      "noteOn",
      "noteOff",
      "allNotesOff"
    ]
  },
  "wcs-voice": {
    "package": "audio",
    "hasWcBindable": false,
    "observedAttributes": [
      "poly"
    ],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-osc": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "frequency",
      "detune",
      "type",
      "glide",
      "transpose",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "frequency": "frequency",
      "detune": "detune",
      "type": "type",
      "glide": "glide",
      "transpose": "transpose"
    },
    "properties": [],
    "commands": []
  },
  "wcs-noise": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-biquad": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "frequency",
      "q",
      "gain",
      "detune",
      "type",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "frequency": "frequency",
      "q": "q",
      "gain": "gain",
      "detune": "detune",
      "type": "type"
    },
    "properties": [],
    "commands": []
  },
  "wcs-gain": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "gain",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "gain": "gain"
    },
    "properties": [],
    "commands": []
  },
  "wcs-delay": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "time",
      "feedback",
      "mix",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "time": "time",
      "feedback": "feedback",
      "mix": "mix"
    },
    "properties": [],
    "commands": []
  },
  "wcs-shaper": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "amount",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "amount": "amount"
    },
    "properties": [],
    "commands": []
  },
  "wcs-env": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "attack",
      "decay",
      "sustain",
      "release",
      "depth",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "attack": "attack",
      "decay": "decay",
      "sustain": "sustain",
      "release": "release",
      "depth": "depth"
    },
    "properties": [],
    "commands": []
  },
  "wcs-lfo": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "rate",
      "depth",
      "type",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "rate": "rate",
      "depth": "depth",
      "type": "type"
    },
    "properties": [],
    "commands": []
  },
  "wcs-analyser": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "fft",
      "smoothing",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "fft": "fft",
      "smoothing": "smoothing"
    },
    "properties": [
      "frame"
    ],
    "commands": [
      "sample"
    ]
  },
  "wcs-broadcast": {
    "package": "broadcast",
    "hasWcBindable": true,
    "observedAttributes": [
      "name"
    ],
    "inputs": {
      "name": "name",
      "manual": "manual"
    },
    "properties": [
      "message",
      "error",
      "errorInfo"
    ],
    "commands": [
      "open",
      "post",
      "close"
    ]
  },
  "wcs-camera": {
    "package": "camera",
    "hasWcBindable": true,
    "observedAttributes": [
      "facing-mode",
      "device-id",
      "audio",
      "width",
      "height"
    ],
    "inputs": {
      "audio": "audio",
      "facingMode": "facing-mode",
      "deviceId": "device-id",
      "width": "width",
      "height": "height",
      "autostart": "autostart",
      "keepAlive": "keep-alive"
    },
    "properties": [
      "active",
      "permission",
      "audioPermission",
      "deviceId",
      "devices",
      "error",
      "errorInfo",
      "streamReady",
      "ended"
    ],
    "commands": [
      "start",
      "stop",
      "switchCamera"
    ]
  },
  "wcs-recorder": {
    "package": "camera",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "mimeType": "mime-type",
      "timeslice": "timeslice",
      "audioBitsPerSecond": "audio-bits",
      "videoBitsPerSecond": "video-bits"
    },
    "properties": [
      "recording",
      "paused",
      "duration",
      "mimeType",
      "blob",
      "objectURL",
      "error",
      "errorInfo",
      "recorded",
      "dataavailable"
    ],
    "commands": [
      "attachStream",
      "start",
      "stop",
      "pause",
      "resume"
    ]
  },
  "wcs-clipboard": {
    "package": "clipboard",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "monitor": "monitor"
    },
    "properties": [
      "text",
      "items",
      "loading",
      "error",
      "readPermission",
      "writePermission",
      "monitoring",
      "errorInfo",
      "copied",
      "cut",
      "pasted"
    ],
    "commands": [
      "writeText",
      "write",
      "readText",
      "read",
      "startMonitor",
      "stopMonitor"
    ]
  },
  "wcs-contacts": {
    "package": "contacts",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "value",
      "loading",
      "error",
      "cancelled",
      "errorInfo"
    ],
    "commands": [
      "select"
    ]
  },
  "wcs-credential": {
    "package": "credential",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "value",
      "loading",
      "error",
      "cancelled",
      "errorInfo"
    ],
    "commands": [
      "get",
      "store"
    ]
  },
  "wcs-debounce": {
    "package": "debounce",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "source": null,
      "wait": "wait",
      "leading": null,
      "trailing": null,
      "maxWait": "max-wait"
    },
    "properties": [
      "value",
      "fired",
      "pending"
    ],
    "commands": [
      "trigger",
      "cancel",
      "flush"
    ]
  },
  "wcs-throttle": {
    "package": "debounce",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "source": null,
      "wait": "wait",
      "leading": null,
      "trailing": null,
      "maxWait": "max-wait"
    },
    "properties": [
      "value",
      "fired",
      "pending"
    ],
    "commands": [
      "trigger",
      "cancel",
      "flush"
    ]
  },
  "wcs-defined": {
    "package": "defined",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "tags": "tags",
      "mode": "mode",
      "timeout": "timeout"
    },
    "properties": [
      "defined",
      "pending",
      "missing",
      "count",
      "total",
      "error"
    ],
    "commands": []
  },
  "wcs-eyedropper": {
    "package": "eyedropper",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "value",
      "loading",
      "error",
      "cancelled",
      "errorInfo"
    ],
    "commands": [
      "open",
      "abort"
    ]
  },
  "wcs-fetch": {
    "package": "fetch",
    "hasWcBindable": true,
    "observedAttributes": [
      "url"
    ],
    "inputs": {
      "url": null,
      "method": null,
      "target": null,
      "manual": null,
      "body": null,
      "responseType": null,
      "trigger": null
    },
    "properties": [
      "value",
      "loading",
      "error",
      "status",
      "objectURL",
      "errorInfo",
      "trigger"
    ],
    "commands": [
      "fetch",
      "abort"
    ]
  },
  "wcs-fetch-header": {
    "package": "fetch",
    "hasWcBindable": false,
    "observedAttributes": [],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-fetch-body": {
    "package": "fetch",
    "hasWcBindable": false,
    "observedAttributes": [],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-infinite-scroll": {
    "package": "fetch",
    "hasWcBindable": false,
    "observedAttributes": [
      "target",
      "root",
      "root-margin",
      "threshold",
      "disabled"
    ],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-fullscreen": {
    "package": "fullscreen",
    "hasWcBindable": true,
    "observedAttributes": [
      "target"
    ],
    "inputs": {
      "target": "target"
    },
    "properties": [
      "active",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestFullscreen",
      "exitFullscreen"
    ]
  },
  "wcs-geo": {
    "package": "geolocation",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "highAccuracy": "high-accuracy",
      "timeout": "timeout",
      "maximumAge": "maximum-age",
      "watch": "watch",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "position",
      "latitude",
      "longitude",
      "accuracy",
      "coords",
      "timestamp",
      "watching",
      "loading",
      "error",
      "permission",
      "errorInfo",
      "trigger"
    ],
    "commands": [
      "getCurrentPosition",
      "watchPosition",
      "clearWatch"
    ]
  },
  "wcs-gyroscope": {
    "package": "gyroscope",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "frequency": null
    },
    "properties": [
      "x",
      "y",
      "z",
      "error",
      "errorInfo"
    ],
    "commands": [
      "start",
      "stop"
    ]
  },
  "wcs-idle": {
    "package": "idle",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "threshold": "threshold"
    },
    "properties": [
      "userState",
      "screenState",
      "active",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestPermission",
      "start",
      "stop"
    ]
  },
  "wcs-intersect": {
    "package": "intersection",
    "hasWcBindable": true,
    "observedAttributes": [
      "target",
      "root",
      "root-margin",
      "threshold"
    ],
    "inputs": {
      "target": "target",
      "root": "root",
      "rootMargin": "root-margin",
      "threshold": "threshold",
      "once": "once",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "entry",
      "intersecting",
      "ratio",
      "visible",
      "observing",
      "trigger"
    ],
    "commands": [
      "observe",
      "reobserve",
      "unobserve",
      "disconnect",
      "reset"
    ]
  },
  "wcs-magnetometer": {
    "package": "magnetometer",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "frequency": null
    },
    "properties": [
      "x",
      "y",
      "z",
      "error",
      "errorInfo"
    ],
    "commands": [
      "start",
      "stop"
    ]
  },
  "wcs-midi": {
    "package": "midi",
    "hasWcBindable": true,
    "observedAttributes": [
      "input",
      "output",
      "channel"
    ],
    "inputs": {
      "input": "input",
      "output": "output",
      "channel": "channel",
      "sysex": "sysex",
      "auto": "auto"
    },
    "properties": [
      "message",
      "type",
      "channel",
      "note",
      "velocity",
      "control",
      "value",
      "devices",
      "connected",
      "permission",
      "granted",
      "denied",
      "unsupported",
      "error",
      "errorInfo"
    ],
    "commands": [
      "request",
      "close",
      "send"
    ]
  },
  "wcs-network": {
    "package": "network",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "effectiveType",
      "downlink",
      "rtt",
      "saveData",
      "supported"
    ],
    "commands": []
  },
  "wcs-notify": {
    "package": "notification",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "notice": null,
      "mode": "mode",
      "body": "body",
      "icon": "icon",
      "badge": "badge",
      "tag": "tag",
      "lang": "lang",
      "dir": "dir",
      "requireInteraction": "require-interaction",
      "silent": "silent",
      "renotify": "renotify",
      "manual": "manual"
    },
    "properties": [
      "permission",
      "granted",
      "denied",
      "prompt",
      "unsupported",
      "error",
      "errorInfo",
      "clicked",
      "closed",
      "shown"
    ],
    "commands": [
      "request",
      "notify",
      "close",
      "closeAll"
    ]
  },
  "wcs-permission": {
    "package": "permission",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "name": "name",
      "userVisibleOnly": "user-visible-only",
      "sysex": "sysex"
    },
    "properties": [
      "state",
      "granted",
      "denied",
      "prompt",
      "unsupported"
    ],
    "commands": []
  },
  "wcs-pip": {
    "package": "picture-in-picture",
    "hasWcBindable": true,
    "observedAttributes": [
      "target"
    ],
    "inputs": {
      "target": "target"
    },
    "properties": [
      "active",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestPictureInPicture",
      "exitPictureInPicture"
    ]
  },
  "wcs-pointer-lock": {
    "package": "pointer-lock",
    "hasWcBindable": true,
    "observedAttributes": [
      "target"
    ],
    "inputs": {
      "target": "target"
    },
    "properties": [
      "active",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestPointerLock",
      "exitPointerLock"
    ]
  },
  "wcs-raf": {
    "package": "raf",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "once": "once",
      "repeat": "repeat",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "tick",
      "elapsed",
      "dt",
      "running",
      "suspended",
      "trigger"
    ],
    "commands": [
      "start",
      "stop",
      "reset",
      "pause",
      "resume"
    ]
  },
  "wcs-resize": {
    "package": "resize",
    "hasWcBindable": true,
    "observedAttributes": [
      "target",
      "box",
      "round"
    ],
    "inputs": {
      "target": "target",
      "box": "box",
      "round": "round",
      "once": "once",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "entry",
      "width",
      "height",
      "observing",
      "trigger"
    ],
    "commands": [
      "observe",
      "unobserve",
      "disconnect"
    ]
  },
  "wcs-screen-orientation": {
    "package": "screen-orientation",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "type",
      "angle",
      "portrait",
      "landscape",
      "error",
      "errorInfo"
    ],
    "commands": [
      "lock",
      "unlock"
    ]
  },
  "wcs-share": {
    "package": "share",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "value",
      "loading",
      "error",
      "cancelled",
      "errorInfo"
    ],
    "commands": [
      "share"
    ]
  },
  "wcs-speak": {
    "package": "speech",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "say": null,
      "rate": "rate",
      "pitch": "pitch",
      "volume": "volume",
      "voice": "voice",
      "lang": "lang",
      "manual": "manual"
    },
    "properties": [
      "voices",
      "speaking",
      "paused",
      "pending",
      "charIndex",
      "spokenWord",
      "error",
      "errorInfo",
      "unsupported"
    ],
    "commands": [
      "speak",
      "cancel",
      "pause",
      "resume"
    ]
  },
  "wcs-listen": {
    "package": "speech",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "lang": "lang",
      "continuous": "continuous",
      "interim": "interim",
      "maxRestarts": "max-restarts",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "interimTranscript",
      "finalTranscript",
      "result",
      "listening",
      "permission",
      "error",
      "errorInfo",
      "unsupported",
      "trigger"
    ],
    "commands": [
      "start",
      "stop",
      "abort"
    ]
  },
  "wcs-sse": {
    "package": "sse",
    "hasWcBindable": true,
    "observedAttributes": [
      "url"
    ],
    "inputs": {
      "url": "url",
      "withCredentials": "with-credentials",
      "events": "events",
      "raw": "raw",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "message",
      "connected",
      "loading",
      "error",
      "errorInfo",
      "readyState",
      "trigger"
    ],
    "commands": [
      "connect",
      "close"
    ]
  },
  "wcs-storage": {
    "package": "storage",
    "hasWcBindable": true,
    "observedAttributes": [
      "key",
      "type"
    ],
    "inputs": {
      "key": null,
      "type": null,
      "value": null,
      "manual": null,
      "trigger": null
    },
    "properties": [
      "value",
      "loading",
      "error",
      "errorInfo",
      "trigger"
    ],
    "commands": [
      "load",
      "save",
      "remove"
    ]
  },
  "wcs-tilt": {
    "package": "tilt",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "alpha",
      "beta",
      "gamma",
      "absolute",
      "permissionState",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestPermission",
      "start",
      "stop"
    ]
  },
  "wcs-timer": {
    "package": "timer",
    "hasWcBindable": true,
    "observedAttributes": [
      "interval"
    ],
    "inputs": {
      "interval": "interval",
      "once": "once",
      "repeat": "repeat",
      "immediate": "immediate",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "tick",
      "elapsed",
      "running",
      "trigger"
    ],
    "commands": [
      "start",
      "stop",
      "reset",
      "pause",
      "resume"
    ]
  },
  "wcs-upload": {
    "package": "upload",
    "hasWcBindable": true,
    "observedAttributes": [
      "url"
    ],
    "inputs": {
      "url": null,
      "method": null,
      "fieldName": null,
      "multiple": null,
      "maxSize": null,
      "accept": null,
      "manual": null,
      "files": null,
      "trigger": null
    },
    "properties": [
      "value",
      "loading",
      "progress",
      "error",
      "status",
      "errorInfo",
      "trigger",
      "files"
    ],
    "commands": [
      "upload",
      "abort"
    ]
  },
  "wcs-wakelock": {
    "package": "wakelock",
    "hasWcBindable": true,
    "observedAttributes": [
      "active",
      "type"
    ],
    "inputs": {
      "active": "active",
      "type": "type",
      "manual": "manual"
    },
    "properties": [
      "held",
      "error",
      "errorInfo"
    ],
    "commands": [
      "request",
      "release"
    ]
  },
  "wcs-ws": {
    "package": "websocket",
    "hasWcBindable": true,
    "observedAttributes": [
      "url"
    ],
    "inputs": {
      "url": "url",
      "protocols": "protocols",
      "autoReconnect": "auto-reconnect",
      "reconnectInterval": "reconnect-interval",
      "maxReconnects": "max-reconnects",
      "binaryType": "binary-type",
      "manual": "manual",
      "trigger": null,
      "send": null
    },
    "properties": [
      "message",
      "connected",
      "loading",
      "error",
      "errorInfo",
      "readyState",
      "trigger",
      "send"
    ],
    "commands": [
      "connect",
      "sendMessage",
      "close"
    ]
  },
  "wcs-worker": {
    "package": "worker",
    "hasWcBindable": true,
    "observedAttributes": [
      "src"
    ],
    "inputs": {
      "src": "src",
      "type": "type",
      "name": "name",
      "manual": "manual",
      "keepAlive": "keep-alive",
      "restartOnError": "restart-on-error",
      "maxRestarts": "max-restarts",
      "restartInterval": "restart-interval"
    },
    "properties": [
      "message",
      "error",
      "errorInfo",
      "running"
    ],
    "commands": [
      "start",
      "post",
      "terminate"
    ]
  }
} as const;
