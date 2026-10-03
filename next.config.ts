import type { NextConfig } from "next";

// 本機檔案模式（公開架站）是純前端，輸出靜態檔給 Cloudflare Pages；伺服器模式才需要 API
const fileMode = process.env.NEXT_PUBLIC_STORAGE === "file";

const nextConfig: NextConfig = fileMode
  ? {
      output: "export",
      // API 檔名是 route.server.ts，只認 .ts 時它不算 route，靜態輸出就不會包含它
      pageExtensions: ["tsx", "ts"],
    }
  : {
      // 產出 .next/standalone，M1 不用 npm install，deploy.sh 直接 rsync 過去
      output: "standalone",
      pageExtensions: ["server.ts", "tsx", "ts"],
      // route 用 path.join(cwd, 'data') 會被 tracing 把本機資料打包進去，排除掉
      outputFileTracingExcludes: { "/*": ["./data/**/*"] },
    };

export default nextConfig;
