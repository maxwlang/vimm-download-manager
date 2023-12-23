#!/bin/bash

echo "Checking if already initialized.."
FILE=.initialized
if test -f "$FILE"; then
    echo "Already initialized, starting up.."
    until yarn start; do
        echo "Server crashed with exit code $?.  Respawning.." >&2
        sleep 1
    done
else
    echo "Initializing.."
    yarn
    touch $FILE
    echo "Done. Starting up.."
    until yarn start; do
        echo "Server crashed with exit code $?.  Respawning.." >&2
        sleep 1
    done
fi