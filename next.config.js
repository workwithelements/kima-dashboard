/** @type {import('next').NextConfig} */
const nextConfig = {
  // Netlify handles output automatically via @netlify/plugin-nextjs
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.fbcdn.net",
      },
    ],
  },
}

module.exports = nextConfig
