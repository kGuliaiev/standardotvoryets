/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,

    // isomorphic-dompurify (server-side HTML sanitization, B-3) pulls in jsdom,
    // which ships runtime resource files (e.g. default-stylesheet.css) that
    // webpack can't bundle — bundling it breaks the build with ENOENT. Mark it
    // external so Next require()s it from node_modules at runtime instead.
    experimental: {
          serverComponentsExternalPackages: ['isomorphic-dompurify'],
    },

    // Allow images from S3/MinIO
    images: {
          remotePatterns: [
            {
                      protocol: 'http',
                      hostname: 'localhost',
                      port: '9000',
                      pathname: '/standardotvoryets/**',
            },
            {
                      protocol: 'https',
                      hostname: '*.amazonaws.com',
                      pathname: '/**',
            },
                ],
    },

    // Security headers
    async headers() {
          return [
            {
                      source: '/(.*)',
                      headers: [
                        {
                                      key: 'X-Frame-Options',
                                      value: 'SAMEORIGIN',
                        },
                        {
                                      key: 'X-Content-Type-Options',
                                      value: 'nosniff',
                        },
                        {
                                      key: 'Referrer-Policy',
                                      value: 'strict-origin-when-cross-origin',
                        },
                                ],
            },
                ];
    },
};

export default nextConfig;
