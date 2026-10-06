// Development convenience for these runnable examples. CLI selection defaults
// to the package's verified release; EMBEDDED_POSTGRES_CLI can override it.
export const options = {
  ...(process.env.EP_TEST_BINARIES ? { binaries: process.env.EP_TEST_BINARIES } : {}),
  ...(process.env.EP_TEST_VERSION ? { postgresVersion: process.env.EP_TEST_VERSION } : {}),
};
