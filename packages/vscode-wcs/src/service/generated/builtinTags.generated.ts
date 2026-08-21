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
    "observedAttributes": [
      "poly"
    ],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-osc": {
    "package": "audio",
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
    "observedAttributes": [],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-fetch-body": {
    "package": "fetch",
    "observedAttributes": [],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-infinite-scroll": {
    "package": "fetch",
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
