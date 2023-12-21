import * as index from '../src/index'

describe('index', () => {
    describe('doSomething', () => {
        it('returns a string', () => {
            expect(index.doSomething()).toEqual('Hello World!')
        })
    })
})
