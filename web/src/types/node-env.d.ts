export {}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly [key: string]: string | undefined
    }

    interface Process {
      readonly env: ProcessEnv
    }
  }

  // eslint-disable-next-line no-var
  var process: NodeJS.Process
}
