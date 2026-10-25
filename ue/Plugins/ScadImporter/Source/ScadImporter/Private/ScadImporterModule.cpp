#include "ScadImporterModule.h"
#include "Misc/Paths.h"
#include "HAL/FileManager.h"
#include "AssetToolsModule.h"
#include "IAssetTools.h"
#include "AutomatedAssetImportData.h"
#if WITH_EDITOR
#include "Editor.h"
#endif

#define LOCTEXT_NAMESPACE "FScadImporterModule"

void FScadImporterModule::StartupModule()
{
#if WITH_EDITOR
	if (GIsEditor)
	{
		FEditorDelegates::OnEditorInitialized.AddRaw(this, &FScadImporterModule::OnEditorInitialized);
	}
#endif
}

void FScadImporterModule::ShutdownModule()
{
#if WITH_EDITOR
	if (GIsEditor)
	{
		FEditorDelegates::OnEditorInitialized.RemoveAll(this);
	}
#endif
}

void FScadImporterModule::OnEditorInitialized()
{
	// Auto-import .scad files in the Content directory that don't have .uassets yet
	FString ContentDir = FPaths::ProjectContentDir();
	TArray<FString> ScadFiles;
	IFileManager::Get().FindFilesRecursive(ScadFiles, *ContentDir, TEXT("*.scad"), true, false);

	TArray<FString> FilesToImport;
	for (const FString& File : ScadFiles)
	{
		FString BaseName = FPaths::GetBaseFilename(File);
		FString AssetPath = FPaths::GetPath(File) / BaseName + TEXT(".uasset");

		if (!FPaths::FileExists(AssetPath))
		{
			FilesToImport.Add(File);
		}
	}

	if (FilesToImport.Num() > 0)
	{
		FAssetToolsModule& AssetToolsModule = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools");

		for (const FString& File : FilesToImport)
		{
			FString DestinationPath = FPaths::GetPath(File);
			FString PackagePath = DestinationPath;
			FPaths::MakePathRelativeTo(PackagePath, *ContentDir);
			PackagePath = TEXT("/Game/") + PackagePath;

			// AutomatedAssetImportData prevents the Editor from showing annoying popup dialogs
			UAutomatedAssetImportData* ImportData = NewObject<UAutomatedAssetImportData>();
			ImportData->bReplaceExisting = true;
			ImportData->DestinationPath = PackagePath;
			ImportData->Filenames.Add(File);

			AssetToolsModule.Get().ImportAssetsAutomated(ImportData);
		}
	}
}

#undef LOCTEXT_NAMESPACE
IMPLEMENT_MODULE(FScadImporterModule, ScadImporter)
