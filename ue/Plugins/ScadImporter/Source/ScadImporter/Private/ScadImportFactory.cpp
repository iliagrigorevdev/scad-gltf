#include "ScadImportFactory.h"
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "HAL/PlatformProcess.h"
#include "AssetToolsModule.h"
#include "IAssetTools.h"
#include "AutomatedAssetImportData.h"

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
	IFileManager::Get().MakeDirectory(*TempDir, true);

	FString UniqueID = FString::Printf(TEXT("%u"), GetTypeHash(Filename));
	FString TempGlbPath = TempDir / (InName.ToString() + TEXT("_") + UniqueID + TEXT(".glb"));
	TempGlbPath = FPaths::ConvertRelativePathToFull(TempGlbPath);
	FString GlobalSource = FPaths::ConvertRelativePathToFull(Filename);
	FPaths::NormalizeFilename(GlobalSource);

	// Using standard scad-convert directly from system PATH
	FString Command = TEXT("scad-convert");
	FString Args = FString::Printf(TEXT("\"%s\" \"%s\""), *GlobalSource, *TempGlbPath);

#if PLATFORM_WINDOWS
	Command = TEXT("cmd.exe");
	Args = FString::Printf(TEXT("/c scad-convert \"%s\" \"%s\""), *GlobalSource, *TempGlbPath);
#endif

	UE_LOG(LogTemp, Log, TEXT("Importing %s via scad-convert..."), *FPaths::GetCleanFilename(Filename));

	int32 ReturnCode = -1;
	FString StdOut, StdErr;
	FPlatformProcess::ExecProcess(*Command, *Args, &ReturnCode, &StdOut, &StdErr);

	if (ReturnCode != 0 || !FPaths::FileExists(TempGlbPath))
	{
		UE_LOG(LogTemp, Error, TEXT("scad-convert conversion failed for %s."), *FPaths::GetCleanFilename(Filename));
		UE_LOG(LogTemp, Error, TEXT("scad-convert output:\n%s"), *StdErr);
		return nullptr;
	}

	FAssetToolsModule& AssetToolsModule = FModuleManager::GetModuleChecked<FAssetToolsModule>("AssetTools");

	// Use Automated Import to suppress UI Dialogs (CRITICAL for silent start-up compilation)
	UAutomatedAssetImportData* ImportData = NewObject<UAutomatedAssetImportData>();
	ImportData->bReplaceExisting = true;
	ImportData->DestinationPath = InParent->GetPathName();
	ImportData->Filenames.Add(TempGlbPath);

	TArray<UObject*> ImportedObjects = AssetToolsModule.Get().ImportAssetsAutomated(ImportData);

	if (FPaths::FileExists(TempGlbPath))
	{
		IFileManager::Get().Delete(*TempGlbPath);
	}

	return ImportedObjects.Num() > 0 ? ImportedObjects[0] : nullptr;
}
