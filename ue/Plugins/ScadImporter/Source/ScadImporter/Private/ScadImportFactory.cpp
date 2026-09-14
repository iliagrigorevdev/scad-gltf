#include "ScadImportFactory.h"
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "HAL/PlatformProcess.h"
#include "AssetToolsModule.h"
#include "IAssetTools.h"

UScadImportFactory::UScadImportFactory()
{
	bCreateNew = false;
	bEditorImport = true;
	// We return a generic object, as GLTF imports usually create scenes/static meshes
	SupportedClass = UObject::StaticClass();
	Formats.Add(TEXT("scad;OpenSCAD Script"));
}

bool UScadImportFactory::FactoryCanImport(const FString& Filename)
{
	return FPaths::GetExtension(Filename).Equals(TEXT("scad"), ESearchCase::IgnoreCase);
}

UObject* UScadImportFactory::FactoryCreateFile(UClass* InClass, UObject* InParent, FName InName, EObjectFlags Flags, const FString& Filename, const TCHAR* Parms, FFeedbackContext* Warn, bool& bOutCanceled)
{
	// 1. Generate Temp Path
	FString TempDir = FPaths::ProjectSavedDir() / TEXT("ScadCache");
	IFileManager::Get().MakeDirectory(*TempDir, true);

	FString UniqueID = FString::Printf(TEXT("%u"), GetTypeHash(Filename));
	FString TempGlbPath = TempDir / (InName.ToString() + TEXT("_") + UniqueID + TEXT(".glb"));
	TempGlbPath = FPaths::ConvertRelativePathToFull(TempGlbPath);
	FString GlobalSource = FPaths::ConvertRelativePathToFull(Filename);
	FPaths::NormalizeFilename(GlobalSource);

	// 2. Setup scad-convert Command
	FString Command = TEXT("scad-convert");
	FString Args = FString::Printf(TEXT("\"%s\" \"%s\""), *GlobalSource, *TempGlbPath);

#if PLATFORM_WINDOWS
	Command = TEXT("cmd.exe");
	Args = FString::Printf(TEXT("/c scad-convert \"%s\" \"%s\""), *GlobalSource, *TempGlbPath);
#endif

	UE_LOG(LogTemp, Log, TEXT("Importing %s via scad-convert..."), *FPaths::GetCleanFilename(Filename));

	// 3. Execute scad-convert Synchronously
	int32 ReturnCode = -1;
	FString StdOut, StdErr;
	FPlatformProcess::ExecProcess(*Command, *Args, &ReturnCode, &StdOut, &StdErr);

	// 4. Check if conversion was successful
	if (ReturnCode != 0 || !FPaths::FileExists(TempGlbPath))
	{
		UE_LOG(LogTemp, Error, TEXT("scad-convert conversion failed for %s."), *FPaths::GetCleanFilename(Filename));
		UE_LOG(LogTemp, Error, TEXT("scad-convert output:\n%s"), *StdErr);
		return nullptr;
	}

	// 5. Hand over to Unreal's GLTF Importer (Interchange/AssetTools)
	FAssetToolsModule& AssetToolsModule = FModuleManager::GetModuleChecked<FAssetToolsModule>("AssetTools");
	TArray<FString> FilesToImport;
	FilesToImport.Add(TempGlbPath);

	// This triggers Unreal's standard import pipeline for GLB in the target content directory
	TArray<UObject*> ImportedObjects = AssetToolsModule.Get().ImportAssets(FilesToImport, InParent->GetPathName());

	// 6. Cleanup
	if (FPaths::FileExists(TempGlbPath))
	{
		IFileManager::Get().Delete(*TempGlbPath);
	}

	// Return the primary created object so the Content Browser selects it
	return ImportedObjects.Num() > 0 ? ImportedObjects[0] : nullptr;
}
