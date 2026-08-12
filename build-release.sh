#!/bin/bash

# NEXUS Manager - Release APK Build Script
# Creates optimized, signed release APK

set -e

echo "🔨 NEXUS Manager - Release APK Build"
echo "======================================"
echo ""

# Check for keystore
if [ ! -f "android/app/release.keystore" ]; then
    echo "⚠️  No signing keystore found!"
    echo ""
    echo "📝 To create a signing key:"
    echo "   keytool -genkey -v -keystore android/app/release.keystore"
    echo "   -keyalg RSA -keysize 2048 -validity 10000"
    echo "   -alias moe-agent-key"
    echo ""
    echo "Then configure gradle.properties with keystore details."
    exit 1
fi

echo "✅ Step 1: Installing dependencies..."
npm install
echo ""

echo "✅ Step 2: Building web assets..."
npm run build
echo ""

echo "✅ Step 3: Syncing Capacitor..."
npx cap sync android
echo ""

echo "✅ Step 4: Building Release APK..."
npm run android:apk:release
echo ""

echo "====================================="
echo "✨ Release Build Complete!"
echo ""
echo "📦 Release APK Location:"
echo "   android/app/build/outputs/apk/release/app-release.apk"
echo ""
echo "🔐 Sign APK (if not auto-signed):"
echo "   jarsigner -verbose -sigalg SHA1withRSA -digestalg SHA1"
echo "   -keystore android/app/release.keystore"
echo "   android/app/build/outputs/apk/release/app-release.apk moe-agent-key"
echo ""
