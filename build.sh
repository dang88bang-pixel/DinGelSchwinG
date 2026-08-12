#!/bin/bash

# NEXUS Manager - Complete Build Script
# Builds APK with all dependencies and configurations

set -e

echo "🔨 NEXUS Manager - APK Build Script"
echo "====================================="
echo ""

# Step 1: Install Dependencies
echo "✅ Step 1: Installing npm dependencies..."
npm install
echo ""

# Step 2: Build Web Assets
echo "✅ Step 2: Building React/Vite assets..."
npm run build
echo ""

# Step 3: Add Android Platform (if not exists)
echo "✅ Step 3: Checking Capacitor Android setup..."
if [ ! -d "android" ]; then
    echo "   → Adding Android platform"
    npx cap add android
fi
echo ""

# Step 4: Sync Capacitor
echo "✅ Step 4: Syncing Capacitor..."
npx cap sync android
echo ""

# Step 5: Build APK (Debug)
echo "✅ Step 5: Building Debug APK..."
npm run android:apk
echo ""

# Step 6: Output Info
echo "====================================="
echo "✨ Build Complete!"
echo ""
echo "📦 Debug APK Location:"
echo "   android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "📋 Next Steps:"
echo "   1. Connect Android device (USB Debugging enabled)"
echo "   2. Run: npm run android:install"
echo "   3. Or install manually: adb install -r android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "🚀 For Release Build:"
echo "   npm run android:apk:release"
echo ""
