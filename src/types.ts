export type Downloads = {
    uri: string
    filePath: string | null
    fileName: string | null
}[]

export type FormData = {
    formAction: string
    formInputs: FormInputs
}

export type FormInputs = {
    name: string
    value: string
}[]
