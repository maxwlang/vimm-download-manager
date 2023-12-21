export const doSomething = (): string => {
    return 'Hello World!'
}
;(async (): Promise<void> => {
    console.log(doSomething())
})()
