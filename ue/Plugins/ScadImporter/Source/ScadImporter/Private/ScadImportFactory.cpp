#include "ScadImportFactory.h"
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "HAL/PlatformProcess.h"
#include "HAL/FileManager.h"
#include "AssetToolsModule.h"
#include "IAssetTools.h"
#include "AutomatedAssetImportData.h"

namespace
{
	bool IsScadGltfAvailable()
	{
		int32 ReturnCode = -1;
		FString StdOut, StdErr;
#if PLATFORM_WINDOWS
		FPlatformProcess::ExecProcess(TEXT("where.exe"), TEXT("scad-gltf"), &ReturnCode, &StdOut, &StdErr);
#else
		FPlatformProcess::ExecProcess(TEXT("/bin/sh"), TEXT("-c \"command -v scad-gltf\""), &ReturnCode, &StdOut, &StdErr);
#endif
		return ReturnCode == 0;
	}

	FString GetCachedGlbPath(const FString& GlobalSource)
	{
		FString ProjectDir = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir());
		FPaths::NormalizeFilename(ProjectDir);
		if (!ProjectDir.EndsWith(TEXT("/")))
		{
			ProjectDir += TEXT("/");
		}

		FString RelPath = GlobalSource;
		FPaths::NormalizeFilename(RelPath);
		if (RelPath.StartsWith(ProjectDir, ESearchCase::IgnoreCase))
		{
			RelPath = RelPath.RightChop(ProjectDir.Len());
		}
		else
		{
			FPaths::MakePathRelativeTo(RelPath, *ProjectDir);
		}

		RelPath.RemoveFromStart(TEXT("./"));
		RelPath.RemoveFromStart(TEXT("/"));

		FString CachedGlbPath = ProjectDir / TEXT("__scad_glbs") / (RelPath + TEXT(".glb"));
		if (FPaths::FileExists(CachedGlbPath))
		{
			return CachedGlbPath;
		}

		FString ContentDir = FPaths::ConvertRelativePathToFull(FPaths::ProjectContentDir());
		FPaths::NormalizeFilename(ContentDir);
		if (!ContentDir.EndsWith(TEXT("/")))
		{
			ContentDir += TEXT("/");
		}
		if (GlobalSource.StartsWith(ContentDir, ESearchCase::IgnoreCase))
		{
			FString RelFromContent = GlobalSource.RightChop(ContentDir.Len());
			FString AltCachedGlbPath = ProjectDir / TEXT("__scad_glbs") / TEXT("Content") / (RelFromContent + TEXT(".glb"));
			if (FPaths::FileExists(AltCachedGlbPath))
			{
				return AltCachedGlbPath;
			}
		}

		return CachedGlbPath;
	}
}

UScadImportFactory::UScadImportFactory()
{
	bCreateNew = false;
	bEditorImport = true;
	SupportedClass = UObject::StaticClass();
	Formats.Add(TEXT("scad;OpenSCAD Script"));
}

bool UScadImportFactory::FactoryCanImport(const FString& Filename)
{
	return FPaths::GetExtension(Filename).Equals(TEXT("scad"), ESearchCase::IgnoreCase);
}

UObject* UScadImportFactory::FactoryCreateFile(UClass* InClass, UObject* InParent, FName InName, EObjectFlags Flags, const FString& Filename, const TCHAR* Parms, FFeedbackContext* Warn, bool& bOutCanceled)
{
	FString TempDir = FPaths::ProjectSavedDir() / TEXT("ScadCache");
	FString UniqueID = FString::Printf(TEXT("%u"), GetTypeHash(Filename));
	FString TempGlbPath = TempDir / UniqueID / (InName.ToString() + TEXT(".glb"));
	TempGlbPath = FPaths::ConvertRelativePathToFull(TempGlbPath);
	IFileManager::Get().MakeDirectory(*FPaths::GetPath(TempGlbPath), true);

	FString GlobalSource = FPaths::ConvertRelativePathToFull(Filename);
	FPaths::NormalizeFilename(GlobalSource);
	FString CachedGlbPath = GetCachedGlbPath(GlobalSource);

	if (IsScadGltfAvailable())
	{
		// Using standard `scad-gltf convert` directly from system PATH
		FString Command = TEXT("scad-gltf");
		FString Args = FString::Printf(TEXT("convert \"%s\" \"%s\""), *GlobalSource, *TempGlbPath);

#if PLATFORM_WINDOWS
		Command = TEXT("cmd.exe");
		Args = FString::Printf(TEXT("/c scad-gltf convert \"%s\" \"%s\""), *GlobalSource, *TempGlbPath);
#endif

		UE_LOG(LogTemp, Log, TEXT("Importing %s via scad-gltf..."), *FPaths::GetCleanFilename(Filename));

		int32 ReturnCode = -1;
		FString StdOut, StdErr;
		FPlatformProcess::ExecProcess(*Command, *Args, &ReturnCode, &StdOut, &StdErr);

		if (ReturnCode != 0 || !FPaths::FileExists(TempGlbPath))
		{
			UE_LOG(LogTemp, Error, TEXT("scad-gltf conversion failed for %s."), *FPaths::GetCleanFilename(Filename));
			UE_LOG(LogTemp, Error, TEXT("scad-gltf output:\n%s"), *StdErr);
			return nullptr;
		}
	}
	else if (FPaths::FileExists(CachedGlbPath))
	{
		UE_LOG(LogTemp, Log, TEXT("scad-gltf not found; using cached GLB fallback for %s (%s)."), *FPaths::GetCleanFilename(Filename), *CachedGlbPath);
		if (IFileManager::Get().Copy(*TempGlbPath, *CachedGlbPath) != COPY_OK || !FPaths::FileExists(TempGlbPath))
		{
			UE_LOG(LogTemp, Error, TEXT("Failed to copy cached GLB from %s to %s."), *CachedGlbPath, *TempGlbPath);
			return nullptr;
		}
	}
	else
	{
		UE_LOG(LogTemp, Error, TEXT("Failed to import SCAD file %s: scad-gltf is not installed and no cached GLB was found at %s."), *FPaths::GetCleanFilename(Filename), *CachedGlbPath);
		return nullptr;
	}

	FAssetToolsModule& AssetToolsModule = FModuleManager::GetModuleChecked<FAssetToolsModule>("AssetTools");

	// Use Automated Import to suppress UI Dialogs (CRITICAL for silent start-up compilation)
	UAutomatedAssetImportData* ImportData = NewObject<UAutomatedAssetImportData>();
	ImportData->bReplaceExisting = true;
	ImportData->DestinationPath = FPaths::GetPath(InParent->GetPathName());
	ImportData->Filenames.Add(TempGlbPath);

	TArray<UObject*> ImportedObjects = AssetToolsModule.Get().ImportAssetsAutomated(ImportData);

	if (FPaths::FileExists(TempGlbPath))
	{
		IFileManager::Get().Delete(*TempGlbPath);
	}

	return ImportedObjects.Num() > 0 ? ImportedObjects[0] : nullptr;
}
