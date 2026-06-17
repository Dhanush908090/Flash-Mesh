#!/usr/bin/env bash

# Source this file before Android/Tauri mobile commands:
#   source scripts/flashmesh-android-env.sh

export JAVA_HOME="${JAVA_HOME:-$HOME/.local/share/flashmesh-toolchains/jdk-17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

if [ -d "$ANDROID_HOME/ndk" ]; then
  export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/$(ls -1 "$ANDROID_HOME/ndk" | sort -V | tail -1)}"
fi

export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
