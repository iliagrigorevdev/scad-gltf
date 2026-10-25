#pragma once

#include "CoreMinimal.h"
#include "Factories/Factory.h"
#include "ScadImportFactory.generated.h"

UCLASS()
class UScadImportFactory : public UFactory
{
	GENERATED_BODY()

public:
	UScadImportFactory();

	// UFactory interface
	virtual bool FactoryCanImport(const FString& Filename) override;
	virtual UObject* FactoryCreateFile(UClass* InClass, UObject* InParent, FName InName, EObjectFlags Flags, const FString& Filename, const TCHAR* Parms, FFeedbackContext* Warn, bool& bOutCanceled) override;
};
