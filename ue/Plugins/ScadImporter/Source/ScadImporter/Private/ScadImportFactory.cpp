#include "ScadImportFactory.h"
#include "Misc/Paths.h"
#include "Misc/PackageName.h"
#include "HAL/FileManager.h"
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
	bOutCanceled = false;

	FString GlobalSource = FPaths::ConvertRelativePathToFull(Filename);
	FPaths::NormalizeFilename(GlobalSource);

	FString UniqueID = FString::Printf(TEXT("%u"), GetTypeHash(GlobalSource));
	FString TempDir = FPaths::ProjectSavedDir() / TEXT("ScadCache") / UniqueID;
	IFileManager::Get().MakeDirectory(*TempDir, true);

	// The GLB file must match InName so the resulting Unreal asset matches the original asset name
	FString TempGlbPath = TempDir / (InName.ToString() + TEXT(".glb"));
	TempGlbPath = FPaths::ConvertRelativePathToFull(TempGlbPath);
	FPaths::NormalizeFilename(TempGlbPath);

	UE_LOG(LogTemp, Log, TEXT("Importing %s via scad-gltf..."), *FPaths::GetCleanFilename(Filename));

	int32 ReturnCode = -1;
	FString StdOut, StdErr;

#if PLATFORM_WINDOWS
	FString Command = TEXT("cmd.exe");
	FString Args = FString::Printf(TEXT("/c \"scad-gltf convert \"%s\" \"%s\"\""), *GlobalSource, *TempGlbPath);
#else
	FString Command = TEXT("/bin/sh");
	FString ShEnv = TEXT("export PATH=\"$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/current/bin\"; ");
	FString Args = FString::Printf(TEXT("-c \"%sscad-gltf convert '%s' '%s'\""), *ShEnv, *GlobalSource, *TempGlbPath);
#endif

	FPlatformProcess::ExecProcess(*Command, *Args, &ReturnCode, &StdOut, &StdErr);

	if (ReturnCode != 0 || !FPaths::FileExists(TempGlbPath))
	{
		UE_LOG(LogTemp, Error, TEXT("scad-gltf conversion failed for %s (exit code %d). Ensure 'scad-gltf' is installed and available in PATH."), *FPaths::GetCleanFilename(Filename), ReturnCode);
		if (!StdErr.IsEmpty())
		{
			UE_LOG(LogTemp, Error, TEXT("scad-gltf stderr:\n%s"), *StdErr);
		}
		if (!StdOut.IsEmpty())
		{
			UE_LOG(LogTemp, Log, TEXT("scad-gltf stdout:\n%s"), *StdOut);
		}
		IFileManager::Get().DeleteDirectory(*TempDir, false, true);
		return nullptr;
	}

	FAssetToolsModule& AssetToolsModule = FModuleManager::GetModuleChecked<FAssetToolsModule>("AssetTools");

	// DestinationPath must be the folder path (e.g., /Game/Models), not the package path (/Game/Models/MyModel)
	FString DestinationPath = TEXT("/Game");
	if (InParent)
	{
		if (InParent->IsA<UPackage>())
		{
			DestinationPath = FPackageName::GetLongPackagePath(InParent->GetPathName());
		}
		else
		{
			DestinationPath = FPackageName::GetLongPackagePath(InParent->GetOutermost()->GetPathName());
		}
		if (DestinationPath.IsEmpty())
		{
			DestinationPath = InParent->GetPathName();
		}
	}

	// Use Automated Import to suppress UI Dialogs (CRITICAL for silent start-up compilation)
	UAutomatedAssetImportData* ImportData = NewObject<UAutomatedAssetImportData>();
	ImportData->bReplaceExisting = true;
	ImportData->DestinationPath = DestinationPath;
	ImportData->Filenames.Add(TempGlbPath);

	TArray<UObject*> ImportedObjects = AssetToolsModule.Get().ImportAssetsAutomated(ImportData);

	if (FPaths::FileExists(TempGlbPath))
	{
		IFileManager::Get().Delete(*TempGlbPath);
	}
	IFileManager::Get().DeleteDirectory(*TempDir, false, true);

	UObject* ResultObject = nullptr;
	for (UObject* Obj : ImportedObjects)
	{
		if (Obj && (Obj->GetName() == InName.ToString() || Obj->GetClass()->GetName().Contains(TEXT("Mesh"))))
		{
			ResultObject = Obj;
			break;
		}
	}
	if (!ResultObject && ImportedObjects.Num() > 0)
	{
		ResultObject = ImportedObjects[0];
	}

	return ResultObject;
}
