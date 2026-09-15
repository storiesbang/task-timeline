import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 產出 .next/standalone，M1 不用 npm install，deploy.sh 直接 rsync 過去
  output: "standalone",
  // route 用 path.join(cwd, 'data') 會被 tracing 把本機資料打包進去，排除掉
  outputFileTracingExcludes: { "/*": ["./data/**/*"] },
};

export default nextConfig;
