const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH
  ?? (process.env.GITHUB_ACTIONS === "true" && repositoryName ? `/${repositoryName}` : "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  output: "export",
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_BASE_PATH: publicBasePath,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

