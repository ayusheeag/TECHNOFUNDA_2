/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Frontend talks only to the API via the dataProvider; set NEXT_PUBLIC_API_URL
  // in the environment (Render API origin). Mock mode is used when unset.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "",
  },
};
export default nextConfig;
