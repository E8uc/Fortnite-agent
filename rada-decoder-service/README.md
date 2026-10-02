# FNAA RADA decode sidecar

A deliberately small sidecar used only after NovaSparx has already extracted a
Fortnite SoundWave in the browser.

Flow:

```
browser/NovaSparx -> raw RADA -> FNAA edge relay -> this service -> WAV -> browser audio
```

The sidecar does not mount Fortnite files, parse packages, fetch manifests, or
replace NovaSparx. It only converts a bounded RADA payload to RIFF/WAVE.

The Docker image downloads the original `radadec.exe` release asset from
GhostScissors/RadA-Decoder at build time. That binary is not copied into this
repository. Review the upstream project's terms before redistributing or
commercially operating the decoder.

Endpoints:

- `GET /healthz`
- `POST /decode` with a raw `application/octet-stream` RADA body

Limits default to 12 MiB input, 64 MiB output, two concurrent decodes, and a
25-second decoder timeout. Set `RADA_SHARED_TOKEN` to require
`X-NovaSparx-Token` on decode requests.
