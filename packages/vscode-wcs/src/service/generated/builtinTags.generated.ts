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
  /** semantics: "handle" の出力（生きたリソース — 値として束ねない）。あるタグにだけある。 */
  readonly handles?: readonly string[];
  /**
   * command 名 → そのメソッドが宣言する引数の数（`Class.prototype[name].length` — 既定値・rest より前の引数）。
   * command のあるタグにだけある。
   */
  readonly commandArity?: Readonly<Record<string, number>>;
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
      "permissionState",
      "error",
      "errorInfo",
      "supported"
    ],
    "commands": [
      "requestPermission",
      "start",
      "stop"
    ],
    "commandArity": {
      "requestPermission": 0,
      "start": 0,
      "stop": 0
    }
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
      "errorInfo",
      "supported"
    ],
    "commands": [
      "start",
      "stop"
    ],
    "commandArity": {
      "start": 0,
      "stop": 0
    }
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
    ],
    "commandArity": {
      "resume": 0,
      "suspend": 0,
      "noteOn": 2,
      "noteOff": 1,
      "allNotesOff": 0
    }
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
    ],
    "commandArity": {
      "sample": 0
    }
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
    ],
    "commandArity": {
      "open": 0,
      "post": 1,
      "close": 0
    }
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
    ],
    "handles": [
      "streamReady"
    ],
    "commandArity": {
      "start": 0,
      "stop": 0,
      "switchCamera": 0
    }
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
    ],
    "commandArity": {
      "attachStream": 1,
      "start": 0,
      "stop": 0,
      "pause": 0,
      "resume": 0
    }
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
    ],
    "commandArity": {
      "writeText": 1,
      "write": 1,
      "readText": 0,
      "read": 0,
      "startMonitor": 0,
      "stopMonitor": 0
    }
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
      "errorInfo",
      "supported"
    ],
    "commands": [
      "select"
    ],
    "commandArity": {
      "select": 2
    }
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
      "errorInfo",
      "supported"
    ],
    "commands": [
      "get",
      "store",
      "preventSilentAccess"
    ],
    "commandArity": {
      "get": 1,
      "store": 1,
      "preventSilentAccess": 0
    }
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
    ],
    "commandArity": {
      "trigger": 0,
      "cancel": 0,
      "flush": 0
    }
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
    ],
    "commandArity": {
      "trigger": 0,
      "cancel": 0,
      "flush": 0
    }
  },
  "wcs-defined": {
    "package": "defined",
    "hasWcBindable": true,
    "observedAttributes": [
      "tags",
      "mode",
      "timeout"
    ],
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
      "errorInfo",
      "supported"
    ],
    "commands": [
      "open",
      "abort"
    ],
    "commandArity": {
      "open": 0,
      "abort": 0
    }
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
    ],
    "commandArity": {
      "fetch": 2,
      "abort": 0
    }
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
      "errorInfo",
      "supported"
    ],
    "commands": [
      "requestFullscreen",
      "exitFullscreen"
    ],
    "commandArity": {
      "requestFullscreen": 0,
      "exitFullscreen": 0
    }
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
    ],
    "commandArity": {
      "getCurrentPosition": 0,
      "watchPosition": 0,
      "clearWatch": 0
    }
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
      "permissionState",
      "error",
      "errorInfo",
      "supported"
    ],
    "commands": [
      "requestPermission",
      "start",
      "stop"
    ],
    "commandArity": {
      "requestPermission": 0,
      "start": 0,
      "stop": 0
    }
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
    ],
    "commandArity": {
      "requestPermission": 0,
      "start": 1,
      "stop": 0
    }
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
    ],
    "commandArity": {
      "observe": 0,
      "reobserve": 0,
      "unobserve": 0,
      "disconnect": 0,
      "reset": 0
    }
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
      "errorInfo",
      "supported"
    ],
    "commands": [
      "start",
      "stop"
    ],
    "commandArity": {
      "start": 0,
      "stop": 0
    }
  },
  "wcs-media-query": {
    "package": "media-query",
    "hasWcBindable": true,
    "observedAttributes": [
      "query"
    ],
    "inputs": {
      "query": "query"
    },
    "properties": [
      "matched",
      "media",
      "supported"
    ],
    "commands": []
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
    ],
    "commandArity": {
      "request": 0,
      "close": 0,
      "send": 2
    }
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
      "supported",
      "offline"
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
    ],
    "commandArity": {
      "request": 0,
      "notify": 2,
      "close": 1,
      "closeAll": 0
    }
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
      "unsupported",
      "unsupportedReason"
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
      "errorInfo",
      "supported"
    ],
    "commands": [
      "requestPictureInPicture",
      "exitPictureInPicture"
    ],
    "commandArity": {
      "requestPictureInPicture": 0,
      "exitPictureInPicture": 0
    }
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
      "errorInfo",
      "supported"
    ],
    "commands": [
      "requestPointerLock",
      "exitPointerLock"
    ],
    "commandArity": {
      "requestPointerLock": 0,
      "exitPointerLock": 0
    }
  },
  "wcs-raf": {
    "package": "raf",
    "hasWcBindable": true,
    "observedAttributes": [
      "reduced-motion"
    ],
    "inputs": {
      "once": "once",
      "repeat": "repeat",
      "manual": "manual",
      "reducedMotion": "reduced-motion",
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
    ],
    "commandArity": {
      "start": 0,
      "stop": 0,
      "reset": 0,
      "pause": 0,
      "resume": 0
    }
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
    ],
    "commandArity": {
      "observe": 0,
      "unobserve": 0,
      "disconnect": 0
    }
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
      "errorInfo",
      "supported"
    ],
    "commands": [
      "lock",
      "unlock"
    ],
    "commandArity": {
      "lock": 1,
      "unlock": 0
    }
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
      "errorInfo",
      "supported"
    ],
    "commands": [
      "share"
    ],
    "commandArity": {
      "share": 1
    }
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
    ],
    "commandArity": {
      "speak": 1,
      "cancel": 0,
      "pause": 0,
      "resume": 0
    }
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
    ],
    "commandArity": {
      "start": 0,
      "stop": 0,
      "abort": 0
    }
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
      "autoReconnect": "auto-reconnect",
      "reconnectInterval": "reconnect-interval",
      "maxReconnects": "max-reconnects",
      "staleAfter": "stale-after",
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
    ],
    "commandArity": {
      "connect": 0,
      "close": 0
    }
  },
  "wcs-storage": {
    "package": "storage",
    "hasWcBindable": true,
    "observedAttributes": [
      "key",
      "storage-key",
      "type"
    ],
    "inputs": {
      "key": null,
      "storageKey": null,
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
    ],
    "commandArity": {
      "load": 0,
      "save": 0,
      "remove": 0
    }
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
      "heading",
      "permissionState",
      "error",
      "errorInfo",
      "supported"
    ],
    "commands": [
      "requestPermission",
      "start",
      "stop"
    ],
    "commandArity": {
      "requestPermission": 0,
      "start": 0,
      "stop": 0
    }
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
    ],
    "commandArity": {
      "start": 0,
      "stop": 0,
      "reset": 0,
      "pause": 0,
      "resume": 0
    }
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
    ],
    "commandArity": {
      "upload": 0,
      "abort": 0
    }
  },
  "wcs-upload-header": {
    "package": "upload",
    "hasWcBindable": false,
    "observedAttributes": [],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-view-transition": {
    "package": "view-transition",
    "hasWcBindable": true,
    "observedAttributes": [
      "mode",
      "naming",
      "naming-limit",
      "reduced-motion",
      "types",
      "disabled",
      "for"
    ],
    "inputs": {
      "disabled": "disabled",
      "mode": "mode",
      "naming": "naming",
      "namingLimit": "naming-limit",
      "reducedMotion": "reduced-motion",
      "types": "types",
      "participants": "for"
    },
    "properties": [
      "active",
      "error"
    ],
    "commands": [
      "skip"
    ],
    "commandArity": {
      "skip": 0
    }
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
    ],
    "commandArity": {
      "request": 0,
      "release": 0
    }
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
      "staleAfter": "stale-after",
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
    ],
    "commandArity": {
      "connect": 0,
      "sendMessage": 1,
      "close": 2
    }
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
    ],
    "commandArity": {
      "start": 0,
      "post": 2,
      "terminate": 0
    }
  }
} as const;
