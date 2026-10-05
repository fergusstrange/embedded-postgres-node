// Development convenience for these runnable examples. Applications can pass
// their own cli: { path } or a reviewed pinned release directly.
export const options = {
  ...(process.env.EP_TEST_BINARIES ? { binaries: process.env.EP_TEST_BINARIES } : {}),
  ...(process.env.EP_TEST_VERSION ? { postgresVersion: process.env.EP_TEST_VERSION } : {}),
};
