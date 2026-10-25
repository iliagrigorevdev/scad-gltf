#include "ScadImporterModule.h"
#include "Misc/Paths.h"
#include "HAL/FileManager.h"
#include "AssetToolsModule.h"
#include "IAssetTools.h"
#include "AutomatedAssetImportData.h"
#if WITH_EDITOR
#include "Editor.h"
#include "FileHelpers.h"
#endif

#define LOCTEXT_NAMESPACE "FScadImporterModule"

void FScadImporterModule::StartupModule()
{
#if WITH_EDITOR
	if (GIsEditor)
	{
		if (GEngine && GEngine->IsInitialized())
		{
			OnEditorInitialized(0.0);
		}
		else
		{
			FEditorDelegates::OnEditorInitialized.AddRaw(this, &FScadImporterModule::OnEditorInitialized);
		}
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

void FScadImporterModule::OnEditorInitialized(double Duration)
{
	// Auto-import .scad files in Content directory that don't have .uassets yet or were modified
	FString ContentDir = FPaths::ProjectContentDir();
	FPaths::NormalizeFilename(ContentDir);

	TArray<FString> ScadFiles;
	IFileManager::Get().FindFilesRecursive(ScadFiles, *ContentDir, TEXT("*.scad"), true, false);

	TArray<FString> FilesToImport;
	for (const FString& File : ScadFiles)
	{
		FString NormalizedFile = File;
		FPaths::NormalizeFilename(NormalizedFile);
		FString BaseName = FPaths::GetBaseFilename(NormalizedFile);
		FString AssetPath = FPaths::GetPath(NormalizedFile) / (BaseName + TEXT(".uasset"));

		if (!FPaths::FileExists(AssetPath) ||
			IFileManager::Get().GetTimeStamp(*NormalizedFile) > IFileManager::Get().GetTimeStamp(*AssetPath))
		{
			FilesToImport.Add(NormalizedFile);
		}
	}

	if (FilesToImport.Num() > 0)
	{
		FAssetToolsModule& AssetToolsModule = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools");
		TArray<UPackage*> PackagesToSave;

		for (const FString& File : FilesToImport)
		{
			FString DestinationDir = FPaths::GetPath(File);
			FString RelPath = DestinationDir;
			FPaths::MakePathRelativeTo(RelPath, *ContentDir);
			RelPath.RemoveFromStart(TEXT("/"));
			RelPath.RemoveFromEnd(TEXT("/"));

			FString PackagePath = RelPath.IsEmpty() ? TEXT("/Game") : (TEXT("/Game/") + RelPath);

			// AutomatedAssetImportData prevents the Editor from showing annoying popup dialogs
			UAutomatedAssetImportData* ImportData = NewObject<UAutomatedAssetImportData>();
			ImportData->bReplaceExisting = true;
			ImportData->DestinationPath = PackagePath;
			ImportData->Filenames.Add(File);

			TArray<UObject*> ImportedAssets = AssetToolsModule.Get().ImportAssetsAutomated(ImportData);
			for (UObject* Asset : ImportedAssets)
			{
				if (Asset && Asset->GetOutermost())
				{
					PackagesToSave.AddUnique(Asset->GetOutermost());
				}
			}
		}

		if (PackagesToSave.Num() > 0)
		{
			UEditorLoadingAndSavingUtils::SavePackages(PackagesToSave, false);
		}
	}
}

#undef LOCTEXT_NAMESPACE
IMPLEMENT_MODULE(FScadImporterModule, ScadImporter)
