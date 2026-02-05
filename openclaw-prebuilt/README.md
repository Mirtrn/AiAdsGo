OpenClaw 预编译产物目录

此目录用于存放 OpenClaw Gateway 运行所需的最小产物，避免在应用镜像构建阶段执行
`pnpm install` / `pnpm build`，以减少构建失败的概率。

目录结构（示例）：
```
openclaw-prebuilt/
  openclaw.mjs
  package.json
  dist/
    entry.js
    index.js
    ...
```

生成方式：
```
./scripts/build-openclaw-prebuilt.sh
```

该脚本会在 Node 22 的容器内完成编译，并将产物同步到本目录。
