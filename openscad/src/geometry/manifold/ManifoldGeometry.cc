// Portions of this file are Copyright 2023 Google LLC, and licensed under GPL2+. See COPYING.
#include "geometry/manifold/ManifoldGeometry.h"

#include <manifold/cross_section.h>
#include <manifold/manifold.h>

#include <cstddef>
#include <cstdint>
#include <exception>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <utility>

#include "geometry/Geometry.h"
#include "geometry/PolySet.h"
#include "geometry/PolySetBuilder.h"
#include "geometry/PolySetUtils.h"
#include "geometry/Polygon2d.h"
#include "geometry/linalg.h"
#include "geometry/manifold/manifoldutils.h"
#include "glview/ColorMap.h"
#include "glview/RenderSettings.h"
#include "utils/printutils.h"
#ifdef ENABLE_CGAL
#include "geometry/cgal/cgalutils.h"
#endif
#include "core/Value.h"

namespace {

template <typename Result, typename V>
Result vector_convert(V const& v)
{
  return Result(v[0], v[1], v[2]);
}

}  // namespace

ManifoldGeometry::ManifoldGeometry() : manifold_(manifold::Manifold())
{
}

ManifoldGeometry::ManifoldGeometry(manifold::Manifold mani, const std::set<uint32_t>& originalIDs,
                                   const std::map<uint32_t, Color4f>& originalIDToColor,
                                   const std::map<uint32_t, float>& originalIDToRoughness,
                                   const std::map<uint32_t, float>& originalIDToMetalness,
                                   const std::map<uint32_t, float>& originalIDToClearcoat,
                                   const std::map<uint32_t, float>& originalIDToClearcoatRoughness,
                                   const std::map<uint32_t, float>& originalIDToSheen,
                                   const std::map<uint32_t, Color4f>& originalIDToSheenColor,
                                   const std::map<uint32_t, float>& originalIDToSheenRoughness,
                                   const std::map<uint32_t, float>& originalIDToTransmission,
                                   const std::map<uint32_t, float>& originalIDToThickness,
                                   const std::map<uint32_t, Color4f>& originalIDToAttenuationColor,
                                   const std::map<uint32_t, float>& originalIDToAttenuationDistance,
                                   const std::map<uint32_t, float>& originalIDToIOR,
                                   const std::map<uint32_t, Color4f>& originalIDToEmissive,
                                   const std::map<uint32_t, float>& originalIDToEmissiveIntensity,
                                   const std::map<uint32_t, Color4f>& originalIDToSpecularColor,
                                   const std::map<uint32_t, float>& originalIDToSpecularIntensity,
                                   const std::map<uint32_t, float>& originalIDToIridescence,
                                   const std::map<uint32_t, float>& originalIDToIridescenceIOR,
                                   const std::map<uint32_t, float>& originalIDToAutoSmoothAngle,
                                   const std::map<uint32_t, std::shared_ptr<const class Value>>& originalIDToColormap,
                                   const std::map<uint32_t, std::shared_ptr<const class Value>>& originalIDToNormalmap,
                                   const std::set<uint32_t>& subtractedIDs)
  : manifold_(std::move(mani)),
    originalIDs_(originalIDs),
    originalIDToColor_(originalIDToColor),
    originalIDToRoughness_(originalIDToRoughness),
    originalIDToMetalness_(originalIDToMetalness),
    originalIDToClearcoat_(originalIDToClearcoat),
    originalIDToClearcoatRoughness_(originalIDToClearcoatRoughness),
    originalIDToSheen_(originalIDToSheen),
    originalIDToSheenColor_(originalIDToSheenColor),
    originalIDToSheenRoughness_(originalIDToSheenRoughness),
    originalIDToTransmission_(originalIDToTransmission),
    originalIDToThickness_(originalIDToThickness),
    originalIDToAttenuationColor_(originalIDToAttenuationColor),
    originalIDToAttenuationDistance_(originalIDToAttenuationDistance),
    originalIDToIOR_(originalIDToIOR),
    originalIDToEmissive_(originalIDToEmissive),
    originalIDToEmissiveIntensity_(originalIDToEmissiveIntensity),
    originalIDToSpecularColor_(originalIDToSpecularColor),
    originalIDToSpecularIntensity_(originalIDToSpecularIntensity),
    originalIDToIridescence_(originalIDToIridescence),
    originalIDToIridescenceIOR_(originalIDToIridescenceIOR),
    originalIDToAutoSmoothAngle_(originalIDToAutoSmoothAngle),
    originalIDToColormap_(originalIDToColormap),
    originalIDToNormalmap_(originalIDToNormalmap),
    subtractedIDs_(subtractedIDs)
{
}

std::unique_ptr<Geometry> ManifoldGeometry::copy() const
{
  return std::make_unique<ManifoldGeometry>(*this);
}

const manifold::Manifold& ManifoldGeometry::getManifold() const
{
  return manifold_;
}

bool ManifoldGeometry::isEmpty() const
{
  return getManifold().IsEmpty();
}

size_t ManifoldGeometry::numFacets() const
{
  return getManifold().NumTri();
}

size_t ManifoldGeometry::numVertices() const
{
  return getManifold().NumVert();
}

bool ManifoldGeometry::isManifold() const
{
  return getManifold().Status() == manifold::Manifold::Error::NoError;
}

bool ManifoldGeometry::isValid() const
{
  return manifold_.Status() == manifold::Manifold::Error::NoError;
}

void ManifoldGeometry::clear()
{
  manifold_ = manifold::Manifold();
}

// Note: We promise to only call memsize if we've already evaluated the object.
// However, there is no way of querying this on the Manifold object itself.
size_t ManifoldGeometry::memsize() const
{
  // Estimated memory usage per vertex:
  // - Position: 24 bytes
  // - Halfedges (approx 6 per vert): 6 * 16 = 96 bytes
  // - Normals (vert + 2*face): 24 + 48 = 72 bytes
  // - Mesh Relation (2*face): 32 bytes
  // Total ~ 224 bytes + vector overhead + properties
  return getManifold().NumVert() * 250;
}

std::string ManifoldGeometry::dump() const
{
  std::ostringstream out;
  auto& manifold = getManifold();
  auto meshgl = manifold.GetMeshGL64();
  out << "Manifold:" << "\n status: " << ManifoldUtils::statusToString(manifold.Status())
      << "\n genus: " << manifold.Genus() << "\n num vertices: " << meshgl.NumVert()
      << "\n num polygons: " << meshgl.NumTri() << "\n polygons data:";

  for (size_t faceid = 0; faceid < meshgl.NumTri(); faceid++) {
    out << "\n  polygon begin:";
    for (const int j : {0, 1, 2}) {
      auto v = vector_convert<Vector3d>(meshgl.GetVertPos(meshgl.GetTriVerts(faceid)[j]));
      out << "\n   vertex:" << v;
    }
  }
  out << "Manifold end";
  return out.str();
}

std::shared_ptr<PolySet> ManifoldGeometry::toPolySet() const
{
  manifold::MeshGL64 mesh = getManifold().GetMeshGL64();
  auto ps = std::make_shared<PolySet>(3);
  ps->setTriangular(true);
  ps->vertices.reserve(mesh.NumVert());
  ps->indices.reserve(mesh.NumTri());
  ps->setConvexity(convexity);
  ps->setManifold(true);

  // first 3 channels are xyz coordinate
  for (size_t i = 0; i < mesh.vertProperties.size(); i += mesh.numProp)
    ps->vertices.emplace_back(mesh.vertProperties[i], mesh.vertProperties[i + 1],
                              mesh.vertProperties[i + 2]);

  ps->colors.reserve(originalIDToColor_.size());
  ps->color_indices.reserve(ps->indices.size());

  auto colorScheme = ColorMap::inst()->findColorScheme(RenderSettings::inst()->colorscheme);
  int32_t faceFrontColorIndex = -1;
  int32_t faceBackColorIndex = -1;

  struct MaterialState {
    Color4f color;
    float roughness;
    float metalness;
    float clearcoat;
    float clearcoatRoughness;
    float sheen;
    Color4f sheenColor;
    float sheenRoughness;
    float transmission;
    float thickness;
    Color4f attenuationColor;
    float attenuationDistance;
    float ior;
    Color4f emissive;
    float emissiveIntensity;
    Color4f specularColor;
    float specularIntensity;
    float iridescence;
    float iridescenceIOR;
    float autoSmoothAngle;
    std::shared_ptr<const class Value> colormap;
    std::shared_ptr<const class Value> normalmap;
    bool operator<(const MaterialState& other) const {
      if (color.r() != other.color.r()) return color.r() < other.color.r();
      if (color.g() != other.color.g()) return color.g() < other.color.g();
      if (color.b() != other.color.b()) return color.b() < other.color.b();
      if (color.a() != other.color.a()) return color.a() < other.color.a();
      if (roughness != other.roughness) return roughness < other.roughness;
      if (metalness != other.metalness) return metalness < other.metalness;
      if (clearcoat != other.clearcoat) return clearcoat < other.clearcoat;
      if (clearcoatRoughness != other.clearcoatRoughness) return clearcoatRoughness < other.clearcoatRoughness;
      if (sheen != other.sheen) return sheen < other.sheen;
      if (sheenColor.r() != other.sheenColor.r()) return sheenColor.r() < other.sheenColor.r();
      if (sheenColor.g() != other.sheenColor.g()) return sheenColor.g() < other.sheenColor.g();
      if (sheenColor.b() != other.sheenColor.b()) return sheenColor.b() < other.sheenColor.b();
      if (sheenColor.a() != other.sheenColor.a()) return sheenColor.a() < other.sheenColor.a();
      if (sheenRoughness != other.sheenRoughness) return sheenRoughness < other.sheenRoughness;
      if (transmission != other.transmission) return transmission < other.transmission;
      if (thickness != other.thickness) return thickness < other.thickness;
      if (attenuationColor.r() != other.attenuationColor.r()) return attenuationColor.r() < other.attenuationColor.r();
      if (attenuationColor.g() != other.attenuationColor.g()) return attenuationColor.g() < other.attenuationColor.g();
      if (attenuationColor.b() != other.attenuationColor.b()) return attenuationColor.b() < other.attenuationColor.b();
      if (attenuationColor.a() != other.attenuationColor.a()) return attenuationColor.a() < other.attenuationColor.a();
      if (attenuationDistance != other.attenuationDistance) return attenuationDistance < other.attenuationDistance;
      if (ior != other.ior) return ior < other.ior;
      if (emissive.r() != other.emissive.r()) return emissive.r() < other.emissive.r();
      if (emissive.g() != other.emissive.g()) return emissive.g() < other.emissive.g();
      if (emissive.b() != other.emissive.b()) return emissive.b() < other.emissive.b();
      if (emissive.a() != other.emissive.a()) return emissive.a() < other.emissive.a();
      if (emissiveIntensity != other.emissiveIntensity) return emissiveIntensity < other.emissiveIntensity;
      if (specularColor.r() != other.specularColor.r()) return specularColor.r() < other.specularColor.r();
      if (specularColor.g() != other.specularColor.g()) return specularColor.g() < other.specularColor.g();
      if (specularColor.b() != other.specularColor.b()) return specularColor.b() < other.specularColor.b();
      if (specularColor.a() != other.specularColor.a()) return specularColor.a() < other.specularColor.a();
      if (specularIntensity != other.specularIntensity) return specularIntensity < other.specularIntensity;
      if (iridescence != other.iridescence) return iridescence < other.iridescence;
      if (iridescenceIOR != other.iridescenceIOR) return iridescenceIOR < other.iridescenceIOR;
      if (autoSmoothAngle != other.autoSmoothAngle) return autoSmoothAngle < other.autoSmoothAngle;
      if (colormap != other.colormap) return colormap < other.colormap;
      return normalmap < other.normalmap;
    }
  };
  std::map<MaterialState, int32_t> materialToIndex;
  std::map<uint32_t, int32_t> originalIDToColorIndex;

  auto getFaceFrontColorIndex = [&]() -> int {
    if (faceFrontColorIndex < 0) {
      faceFrontColorIndex = ps->colors.size();
      ps->colors.push_back(ColorMap::getColor(*colorScheme, RenderColor::CGAL_FACE_FRONT_COLOR));
      ps->roughnesses.push_back(1.0f);
      ps->metalnesses.push_back(0.0f);
      ps->clearcoats.push_back(0.0f);
      ps->clearcoatRoughnesses.push_back(0.0f);
      ps->sheens.push_back(0.0f);
      Vector4f defaultSheen; defaultSheen[0]=0; defaultSheen[1]=0; defaultSheen[2]=0; defaultSheen[3]=1;
      ps->sheenColors.push_back(defaultSheen);
      ps->sheenRoughnesses.push_back(0.0f);
      ps->transmissions.push_back(0.0f);
      ps->thicknesses.push_back(0.0f);
      Vector4f defaultWhite; defaultWhite[0]=1; defaultWhite[1]=1; defaultWhite[2]=1; defaultWhite[3]=1;
      ps->attenuationColors.push_back(defaultWhite);
      ps->attenuationDistances.push_back(0.0f);
      ps->iors.push_back(1.5f);
      ps->emissives.push_back(defaultSheen);
      ps->emissiveIntensities.push_back(1.0f);
      ps->specularColors.push_back(defaultWhite);
      ps->specularIntensities.push_back(1.0f);
      ps->iridescences.push_back(0.0f);
      ps->iridescenceIORs.push_back(1.3f);
      ps->autoSmoothAngles.push_back(0.0f);
      ps->colormaps.push_back(nullptr);
      ps->normalmaps.push_back(nullptr);
    }
    return faceFrontColorIndex;
  };
  auto getFaceBackColorIndex = [&]() -> int {
    if (faceBackColorIndex < 0) {
      faceBackColorIndex = ps->colors.size();
      ps->colors.push_back(ColorMap::getColor(*colorScheme, RenderColor::CGAL_FACE_BACK_COLOR));
      ps->roughnesses.push_back(1.0f);
      ps->metalnesses.push_back(0.0f);
      ps->clearcoats.push_back(0.0f);
      ps->clearcoatRoughnesses.push_back(0.0f);
      ps->sheens.push_back(0.0f);
      Vector4f defaultSheen; defaultSheen[0]=0; defaultSheen[1]=0; defaultSheen[2]=0; defaultSheen[3]=1;
      ps->sheenColors.push_back(defaultSheen);
      ps->sheenRoughnesses.push_back(0.0f);
      ps->transmissions.push_back(0.0f);
      ps->thicknesses.push_back(0.0f);
      Vector4f defaultWhite; defaultWhite[0]=1; defaultWhite[1]=1; defaultWhite[2]=1; defaultWhite[3]=1;
      ps->attenuationColors.push_back(defaultWhite);
      ps->attenuationDistances.push_back(0.0f);
      ps->iors.push_back(1.5f);
      ps->emissives.push_back(defaultSheen);
      ps->emissiveIntensities.push_back(1.0f);
      ps->specularColors.push_back(defaultWhite);
      ps->specularIntensities.push_back(1.0f);
      ps->iridescences.push_back(0.0f);
      ps->iridescenceIORs.push_back(1.3f);
      ps->autoSmoothAngles.push_back(0.0f);
      ps->colormaps.push_back(nullptr);
    }
    return faceBackColorIndex;
  };

  auto getColorIndex = [&](uint32_t originalID) -> int32_t {
    if (subtractedIDs_.find(originalID) != subtractedIDs_.end()) {
      return getFaceBackColorIndex();
    }
    auto colorIndexIt = originalIDToColorIndex.find(originalID);
    if (colorIndexIt != originalIDToColorIndex.end()) {
      return colorIndexIt->second;
    }
    auto colorIt = originalIDToColor_.find(originalID);
    if (colorIt == originalIDToColor_.end()) {
      return getFaceFrontColorIndex();
    }
    const auto& color = colorIt->second;
    float roughness = 1.0f;
    auto roughIt = originalIDToRoughness_.find(originalID);
    if (roughIt != originalIDToRoughness_.end()) roughness = roughIt->second;

    float metalness = 0.0f;
    auto metalIt = originalIDToMetalness_.find(originalID);
    if (metalIt != originalIDToMetalness_.end()) metalness = metalIt->second;

    float clearcoat = 0.0f;
    auto ccIt = originalIDToClearcoat_.find(originalID);
    if (ccIt != originalIDToClearcoat_.end()) clearcoat = ccIt->second;

    float clearcoatRoughness = 0.0f;
    auto ccrIt = originalIDToClearcoatRoughness_.find(originalID);
    if (ccrIt != originalIDToClearcoatRoughness_.end()) clearcoatRoughness = ccrIt->second;

    float sheen = 0.0f;
    auto sheenIt = originalIDToSheen_.find(originalID);
    if (sheenIt != originalIDToSheen_.end()) sheen = sheenIt->second;

    Color4f sheenColor;
    Vector4f defSheenColor; defSheenColor[0]=0; defSheenColor[1]=0; defSheenColor[2]=0; defSheenColor[3]=1;
    sheenColor = defSheenColor;
    auto sheenColorIt = originalIDToSheenColor_.find(originalID);
    if (sheenColorIt != originalIDToSheenColor_.end()) sheenColor = sheenColorIt->second;

    float sheenRoughness = 0.0f;
    auto sheenRoughIt = originalIDToSheenRoughness_.find(originalID);
    if (sheenRoughIt != originalIDToSheenRoughness_.end()) sheenRoughness = sheenRoughIt->second;

    float transmission = 0.0f;
    auto transIt = originalIDToTransmission_.find(originalID);
    if (transIt != originalIDToTransmission_.end()) transmission = transIt->second;

    float thickness = 0.0f;
    auto thickIt = originalIDToThickness_.find(originalID);
    if (thickIt != originalIDToThickness_.end()) thickness = thickIt->second;

    Color4f attenuationColor;
    Vector4f defWhite; defWhite[0]=1; defWhite[1]=1; defWhite[2]=1; defWhite[3]=1;
    attenuationColor = defWhite;
    auto attColorIt = originalIDToAttenuationColor_.find(originalID);
    if (attColorIt != originalIDToAttenuationColor_.end()) attenuationColor = attColorIt->second;

    float attenuationDistance = 0.0f;
    auto attDistIt = originalIDToAttenuationDistance_.find(originalID);
    if (attDistIt != originalIDToAttenuationDistance_.end()) attenuationDistance = attDistIt->second;

    float ior = 1.5f;
    auto iorIt = originalIDToIOR_.find(originalID);
    if (iorIt != originalIDToIOR_.end()) ior = iorIt->second;

    Color4f emissive = defSheenColor; // black
    auto emissiveIt = originalIDToEmissive_.find(originalID);
    if (emissiveIt != originalIDToEmissive_.end()) emissive = emissiveIt->second;

    float emissiveIntensity = 1.0f;
    auto emIntIt = originalIDToEmissiveIntensity_.find(originalID);
    if (emIntIt != originalIDToEmissiveIntensity_.end()) emissiveIntensity = emIntIt->second;

    Color4f specularColor = defWhite;
    auto specColorIt = originalIDToSpecularColor_.find(originalID);
    if (specColorIt != originalIDToSpecularColor_.end()) specularColor = specColorIt->second;

    float specularIntensity = 1.0f;
    auto specIntIt = originalIDToSpecularIntensity_.find(originalID);
    if (specIntIt != originalIDToSpecularIntensity_.end()) specularIntensity = specIntIt->second;

    float iridescence = 0.0f;
    auto iridIt = originalIDToIridescence_.find(originalID);
    if (iridIt != originalIDToIridescence_.end()) iridescence = iridIt->second;

    float iridescenceIOR = 1.3f;
    auto iridIORIt = originalIDToIridescenceIOR_.find(originalID);
    if (iridIORIt != originalIDToIridescenceIOR_.end()) iridescenceIOR = iridIORIt->second;

    float autoSmoothAngle = 0.0f;
    auto asaIt = originalIDToAutoSmoothAngle_.find(originalID);
    if (asaIt != originalIDToAutoSmoothAngle_.end()) autoSmoothAngle = asaIt->second;

    std::shared_ptr<const Value> colormap = nullptr;
    auto cmIt = originalIDToColormap_.find(originalID);
    if (cmIt != originalIDToColormap_.end()) colormap = cmIt->second;

    std::shared_ptr<const Value> normalmap = nullptr;
    auto nmIt = originalIDToNormalmap_.find(originalID);
    if (nmIt != originalIDToNormalmap_.end()) normalmap = nmIt->second;

    auto matIt = materialToIndex.lower_bound({color, roughness, metalness, clearcoat, clearcoatRoughness, sheen, sheenColor, sheenRoughness, transmission, thickness, attenuationColor, attenuationDistance, ior, emissive, emissiveIntensity, specularColor, specularIntensity, iridescence, iridescenceIOR, autoSmoothAngle, colormap, normalmap});
    bool match = false;
    if (matIt != materialToIndex.end()) {
      const auto& c1 = matIt->first.color;
      const auto& c2 = color;
      match = (c1.r() == c2.r() && c1.g() == c2.g() && c1.b() == c2.b() && c1.a() == c2.a() &&
               matIt->first.roughness == roughness && matIt->first.metalness == metalness &&
               matIt->first.clearcoat == clearcoat && matIt->first.clearcoatRoughness == clearcoatRoughness &&
               matIt->first.sheen == sheen &&
               matIt->first.sheenColor.r() == sheenColor.r() && matIt->first.sheenColor.g() == sheenColor.g() &&
               matIt->first.sheenColor.b() == sheenColor.b() && matIt->first.sheenColor.a() == sheenColor.a() &&
               matIt->first.sheenRoughness == sheenRoughness &&
               matIt->first.transmission == transmission && matIt->first.thickness == thickness &&
               matIt->first.attenuationColor.r() == attenuationColor.r() && matIt->first.attenuationColor.g() == attenuationColor.g() &&
               matIt->first.attenuationColor.b() == attenuationColor.b() && matIt->first.attenuationColor.a() == attenuationColor.a() &&
               matIt->first.attenuationDistance == attenuationDistance && matIt->first.ior == ior &&
               matIt->first.emissive.r() == emissive.r() && matIt->first.emissive.g() == emissive.g() &&
               matIt->first.emissive.b() == emissive.b() && matIt->first.emissive.a() == emissive.a() &&
               matIt->first.emissiveIntensity == emissiveIntensity &&
               matIt->first.specularColor.r() == specularColor.r() && matIt->first.specularColor.g() == specularColor.g() &&
               matIt->first.specularColor.b() == specularColor.b() && matIt->first.specularColor.a() == specularColor.a() &&
               matIt->first.specularIntensity == specularIntensity &&
               matIt->first.iridescence == iridescence && matIt->first.iridescenceIOR == iridescenceIOR &&
               matIt->first.autoSmoothAngle == autoSmoothAngle &&
               matIt->first.colormap == colormap &&
               matIt->first.normalmap == normalmap);
    }

    if (match) {
      originalIDToColorIndex[originalID] = matIt->second;
      return matIt->second;
    } else {
      int32_t color_index = ps->colors.size();
      ps->colors.push_back(color);
      ps->roughnesses.push_back(roughness);
      ps->metalnesses.push_back(metalness);
      ps->clearcoats.push_back(clearcoat);
      ps->clearcoatRoughnesses.push_back(clearcoatRoughness);
      ps->sheens.push_back(sheen);
      ps->sheenColors.push_back(sheenColor);
      ps->sheenRoughnesses.push_back(sheenRoughness);
      ps->transmissions.push_back(transmission);
      ps->thicknesses.push_back(thickness);
      ps->attenuationColors.push_back(attenuationColor);
      ps->attenuationDistances.push_back(attenuationDistance);
      ps->iors.push_back(ior);
      ps->emissives.push_back(emissive);
      ps->emissiveIntensities.push_back(emissiveIntensity);
      ps->specularColors.push_back(specularColor);
      ps->specularIntensities.push_back(specularIntensity);
      ps->iridescences.push_back(iridescence);
      ps->iridescenceIORs.push_back(iridescenceIOR);
      ps->autoSmoothAngles.push_back(autoSmoothAngle);
      ps->colormaps.push_back(colormap);
      ps->normalmaps.push_back(normalmap);
      materialToIndex.insert(matIt, {{color, roughness, metalness, clearcoat, clearcoatRoughness, sheen, sheenColor, sheenRoughness, transmission, thickness, attenuationColor, attenuationDistance, ior, emissive, emissiveIntensity, specularColor, specularIntensity, iridescence, iridescenceIOR, autoSmoothAngle, colormap, normalmap}, color_index});
      originalIDToColorIndex[originalID] = color_index;
      return color_index;
    }
  };

  auto start = mesh.runIndex[0];
  for (int run = 0, numRun = mesh.runIndex.size() - 1; run < numRun; ++run) {
    const auto id = mesh.runOriginalID[run];
    const auto end = mesh.runIndex[run + 1];
    const size_t numTri = (end - start) / 3;
    if (numTri == 0) {
      continue;
    }

    auto colorIndex = getColorIndex(id);
    for (size_t i = start; i < end; i += 3) {
      ps->indices.push_back({static_cast<int>(mesh.triVerts[i]), static_cast<int>(mesh.triVerts[i + 1]),
                             static_cast<int>(mesh.triVerts[i + 2])});
      ps->color_indices.push_back(colorIndex);
    }
    start = end;
  }
  return ps;
}

#ifdef ENABLE_CGAL
template <typename Polyhedron>
class CGALPolyhedronBuilderFromManifold : public CGAL::Modifier_base<typename Polyhedron::HalfedgeDS>
{
  using HDS = typename Polyhedron::HalfedgeDS;
  using CGAL_Polybuilder = CGAL::Polyhedron_incremental_builder_3<typename Polyhedron::HalfedgeDS>;

public:
  using CGALPoint = typename CGAL_Polybuilder::Point_3;

  const manifold::MeshGL64& meshgl;
  CGALPolyhedronBuilderFromManifold(const manifold::MeshGL64& mesh) : meshgl(mesh) {}

  void operator()(HDS& hds) override
  {
    CGAL_Polybuilder B(hds, true);

    B.begin_surface(meshgl.NumVert(), meshgl.NumTri());
    for (size_t vertid = 0; vertid < meshgl.NumVert(); vertid++)
      B.add_vertex(CGALUtils::vector_convert<CGALPoint>(meshgl.GetVertPos(vertid)));

    for (size_t faceid = 0; faceid < meshgl.NumTri(); faceid++) {
      const auto tv = meshgl.GetTriVerts(faceid);
      B.begin_facet();
      for (const int j : {0, 1, 2}) {
        B.add_vertex_to_facet(tv[j]);
      }
      B.end_facet();
    }
    B.end_surface();
  }
};

template <class Polyhedron>
std::shared_ptr<Polyhedron> ManifoldGeometry::toPolyhedron() const
{
  auto p = std::make_shared<Polyhedron>();
  try {
    auto meshgl = getManifold().GetMeshGL64();
    CGALPolyhedronBuilderFromManifold<Polyhedron> builder(meshgl);
    p->delegate(builder);
  } catch (const CGAL::Assertion_exception& e) {
    LOG(message_group::Error, "CGAL error in ManifoldGeometry::toPolyhedron(): %1$s", e.what());
  }
  return p;
}

template std::shared_ptr<CGAL::Polyhedron_3<CGAL_Kernel3>> ManifoldGeometry::toPolyhedron() const;

#endif

ManifoldGeometry ManifoldGeometry::binOp(const ManifoldGeometry& lhs, const ManifoldGeometry& rhs,
                                         manifold::OpType opType) const
{
  auto mani = lhs.manifold_.Boolean(rhs.manifold_, opType);
  auto originalIDToColor = lhs.originalIDToColor_;
  auto originalIDToRoughness = lhs.originalIDToRoughness_;
  auto originalIDToMetalness = lhs.originalIDToMetalness_;
  auto originalIDToClearcoat = lhs.originalIDToClearcoat_;
  auto originalIDToClearcoatRoughness = lhs.originalIDToClearcoatRoughness_;
  auto originalIDToSheen = lhs.originalIDToSheen_;
  auto originalIDToSheenColor = lhs.originalIDToSheenColor_;
  auto originalIDToSheenRoughness = lhs.originalIDToSheenRoughness_;
  auto originalIDToTransmission = lhs.originalIDToTransmission_;
  auto originalIDToThickness = lhs.originalIDToThickness_;
  auto originalIDToAttenuationColor = lhs.originalIDToAttenuationColor_;
  auto originalIDToAttenuationDistance = lhs.originalIDToAttenuationDistance_;
  auto originalIDToIOR = lhs.originalIDToIOR_;
  auto originalIDToEmissive = lhs.originalIDToEmissive_;
  auto originalIDToEmissiveIntensity = lhs.originalIDToEmissiveIntensity_;
  auto originalIDToSpecularColor = lhs.originalIDToSpecularColor_;
  auto originalIDToSpecularIntensity = lhs.originalIDToSpecularIntensity_;
  auto originalIDToIridescence = lhs.originalIDToIridescence_;
  auto originalIDToIridescenceIOR = lhs.originalIDToIridescenceIOR_;
  auto originalIDToAutoSmoothAngle = lhs.originalIDToAutoSmoothAngle_;
  auto originalIDToColormap = lhs.originalIDToColormap_;
  auto originalIDToNormalmap = lhs.originalIDToNormalmap_;
  auto subtractedIDs = lhs.subtractedIDs_;

  auto originalIDs = lhs.originalIDs_;
  originalIDs.insert(rhs.originalIDs_.begin(), rhs.originalIDs_.end());

  if (opType == manifold::OpType::Subtract) {
    // Mark all the original ids coming from rhs as subtracted, unless they're mapped to a color.
    for (const auto id : rhs.originalIDs_) {
      auto it = rhs.originalIDToColor_.find(id);
      if (it != rhs.originalIDToColor_.end()) {
        originalIDToColor[id] = it->second;
        auto rit = rhs.originalIDToRoughness_.find(id);
        originalIDToRoughness[id] = rit != rhs.originalIDToRoughness_.end() ? rit->second : 1.0f;
        auto mit = rhs.originalIDToMetalness_.find(id);
        originalIDToMetalness[id] = mit != rhs.originalIDToMetalness_.end() ? mit->second : 0.0f;
        auto ccit = rhs.originalIDToClearcoat_.find(id);
        originalIDToClearcoat[id] = ccit != rhs.originalIDToClearcoat_.end() ? ccit->second : 0.0f;
        auto ccrit = rhs.originalIDToClearcoatRoughness_.find(id);
        originalIDToClearcoatRoughness[id] = ccrit != rhs.originalIDToClearcoatRoughness_.end() ? ccrit->second : 0.0f;
        auto sit = rhs.originalIDToSheen_.find(id);
        originalIDToSheen[id] = sit != rhs.originalIDToSheen_.end() ? sit->second : 0.0f;
        auto scit = rhs.originalIDToSheenColor_.find(id);
        if (scit != rhs.originalIDToSheenColor_.end()) {
          originalIDToSheenColor[id] = scit->second;
        } else {
          Vector4f defSheenColor; defSheenColor[0]=0; defSheenColor[1]=0; defSheenColor[2]=0; defSheenColor[3]=1;
          originalIDToSheenColor[id] = defSheenColor;
        }
        auto srit = rhs.originalIDToSheenRoughness_.find(id);
        originalIDToSheenRoughness[id] = srit != rhs.originalIDToSheenRoughness_.end() ? srit->second : 0.0f;
        auto transIt = rhs.originalIDToTransmission_.find(id);
        originalIDToTransmission[id] = transIt != rhs.originalIDToTransmission_.end() ? transIt->second : 0.0f;
        auto thickIt = rhs.originalIDToThickness_.find(id);
        originalIDToThickness[id] = thickIt != rhs.originalIDToThickness_.end() ? thickIt->second : 0.0f;
        auto attColIt = rhs.originalIDToAttenuationColor_.find(id);
        if (attColIt != rhs.originalIDToAttenuationColor_.end()) originalIDToAttenuationColor[id] = attColIt->second;
        else { Vector4f defW; defW[0]=1; defW[1]=1; defW[2]=1; defW[3]=1; originalIDToAttenuationColor[id] = defW; }
        auto attDistIt = rhs.originalIDToAttenuationDistance_.find(id);
        originalIDToAttenuationDistance[id] = attDistIt != rhs.originalIDToAttenuationDistance_.end() ? attDistIt->second : 0.0f;
        auto iorIt = rhs.originalIDToIOR_.find(id);
        originalIDToIOR[id] = iorIt != rhs.originalIDToIOR_.end() ? iorIt->second : 1.5f;
        auto emIt = rhs.originalIDToEmissive_.find(id);
        if (emIt != rhs.originalIDToEmissive_.end()) originalIDToEmissive[id] = emIt->second;
        else { Vector4f defB; defB[0]=0; defB[1]=0; defB[2]=0; defB[3]=1; originalIDToEmissive[id] = defB; }
        auto emIntIt = rhs.originalIDToEmissiveIntensity_.find(id);
        originalIDToEmissiveIntensity[id] = emIntIt != rhs.originalIDToEmissiveIntensity_.end() ? emIntIt->second : 1.0f;
        auto spColIt = rhs.originalIDToSpecularColor_.find(id);
        if (spColIt != rhs.originalIDToSpecularColor_.end()) originalIDToSpecularColor[id] = spColIt->second;
        else { Vector4f defW; defW[0]=1; defW[1]=1; defW[2]=1; defW[3]=1; originalIDToSpecularColor[id] = defW; }
        auto spIntIt = rhs.originalIDToSpecularIntensity_.find(id);
        originalIDToSpecularIntensity[id] = spIntIt != rhs.originalIDToSpecularIntensity_.end() ? spIntIt->second : 1.0f;
        auto iriIt = rhs.originalIDToIridescence_.find(id);
        originalIDToIridescence[id] = iriIt != rhs.originalIDToIridescence_.end() ? iriIt->second : 0.0f;
        auto iriIorIt = rhs.originalIDToIridescenceIOR_.find(id);
        originalIDToIridescenceIOR[id] = iriIorIt != rhs.originalIDToIridescenceIOR_.end() ? iriIorIt->second : 1.3f;
        auto asaIt = rhs.originalIDToAutoSmoothAngle_.find(id);
        originalIDToAutoSmoothAngle[id] = asaIt != rhs.originalIDToAutoSmoothAngle_.end() ? asaIt->second : 0.0f;
        auto cmIt = rhs.originalIDToColormap_.find(id);
        originalIDToColormap[id] = cmIt != rhs.originalIDToColormap_.end() ? cmIt->second : nullptr;
        auto nmIt = rhs.originalIDToNormalmap_.find(id);
        originalIDToNormalmap[id] = nmIt != rhs.originalIDToNormalmap_.end() ? nmIt->second : nullptr;
      } else {
        subtractedIDs.insert(id);
      }
    }
  } else {
    // Add the id -> color mapping from the rhs.
    originalIDToColor.insert(rhs.originalIDToColor_.begin(), rhs.originalIDToColor_.end());
    originalIDToRoughness.insert(rhs.originalIDToRoughness_.begin(), rhs.originalIDToRoughness_.end());
    originalIDToMetalness.insert(rhs.originalIDToMetalness_.begin(), rhs.originalIDToMetalness_.end());
    originalIDToClearcoat.insert(rhs.originalIDToClearcoat_.begin(), rhs.originalIDToClearcoat_.end());
    originalIDToClearcoatRoughness.insert(rhs.originalIDToClearcoatRoughness_.begin(), rhs.originalIDToClearcoatRoughness_.end());
    originalIDToSheen.insert(rhs.originalIDToSheen_.begin(), rhs.originalIDToSheen_.end());
    originalIDToSheenColor.insert(rhs.originalIDToSheenColor_.begin(), rhs.originalIDToSheenColor_.end());
    originalIDToSheenRoughness.insert(rhs.originalIDToSheenRoughness_.begin(), rhs.originalIDToSheenRoughness_.end());
    originalIDToTransmission.insert(rhs.originalIDToTransmission_.begin(), rhs.originalIDToTransmission_.end());
    originalIDToThickness.insert(rhs.originalIDToThickness_.begin(), rhs.originalIDToThickness_.end());
    originalIDToAttenuationColor.insert(rhs.originalIDToAttenuationColor_.begin(), rhs.originalIDToAttenuationColor_.end());
    originalIDToAttenuationDistance.insert(rhs.originalIDToAttenuationDistance_.begin(), rhs.originalIDToAttenuationDistance_.end());
    originalIDToIOR.insert(rhs.originalIDToIOR_.begin(), rhs.originalIDToIOR_.end());
    originalIDToEmissive.insert(rhs.originalIDToEmissive_.begin(), rhs.originalIDToEmissive_.end());
    originalIDToEmissiveIntensity.insert(rhs.originalIDToEmissiveIntensity_.begin(), rhs.originalIDToEmissiveIntensity_.end());
    originalIDToSpecularColor.insert(rhs.originalIDToSpecularColor_.begin(), rhs.originalIDToSpecularColor_.end());
    originalIDToSpecularIntensity.insert(rhs.originalIDToSpecularIntensity_.begin(), rhs.originalIDToSpecularIntensity_.end());
    originalIDToIridescence.insert(rhs.originalIDToIridescence_.begin(), rhs.originalIDToIridescence_.end());
    originalIDToIridescenceIOR.insert(rhs.originalIDToIridescenceIOR_.begin(), rhs.originalIDToIridescenceIOR_.end());
    originalIDToAutoSmoothAngle.insert(rhs.originalIDToAutoSmoothAngle_.begin(), rhs.originalIDToAutoSmoothAngle_.end());
    originalIDToColormap.insert(rhs.originalIDToColormap_.begin(), rhs.originalIDToColormap_.end());
    originalIDToNormalmap.insert(rhs.originalIDToNormalmap_.begin(), rhs.originalIDToNormalmap_.end());
    subtractedIDs.insert(rhs.subtractedIDs_.begin(), rhs.subtractedIDs_.end());
  }
  return {mani, originalIDs, originalIDToColor, originalIDToRoughness, originalIDToMetalness, originalIDToClearcoat, originalIDToClearcoatRoughness, originalIDToSheen, originalIDToSheenColor, originalIDToSheenRoughness, originalIDToTransmission, originalIDToThickness, originalIDToAttenuationColor, originalIDToAttenuationDistance, originalIDToIOR, originalIDToEmissive, originalIDToEmissiveIntensity, originalIDToSpecularColor, originalIDToSpecularIntensity, originalIDToIridescence, originalIDToIridescenceIOR, originalIDToAutoSmoothAngle, originalIDToColormap, originalIDToNormalmap, subtractedIDs};
}

std::shared_ptr<ManifoldGeometry> minkowskiOp(const ManifoldGeometry& lhs, const ManifoldGeometry& rhs)
{
// FIXME: How to deal with operation not supported?
#ifdef ENABLE_CGAL
  auto lhs_nef =
    std::shared_ptr<CGALNefGeometry>(CGALUtils::createNefPolyhedronFromPolySet(*lhs.toPolySet()));
  auto rhs_nef =
    std::shared_ptr<CGALNefGeometry>(CGALUtils::createNefPolyhedronFromPolySet(*rhs.toPolySet()));
  if (lhs_nef->isEmpty() || rhs_nef->isEmpty()) {
    return {};
  }
  std::shared_ptr<const PolySet> ps;
  try {
    lhs_nef->minkowski(*rhs_nef);
    ps = PolySetUtils::getGeometryAsPolySet(lhs_nef);
    if (ps) {
      return ManifoldUtils::createManifoldFromPolySet(*ps);
    }
  } catch (const std::exception& e) {
    LOG(message_group::Error, "Nef minkoswki operation failed: %1$s\n", e.what());
  } catch (...) {
    LOG(message_group::Warning, "Nef minkowski hard-crashed");
  }
#endif
  return {};
}

ManifoldGeometry ManifoldGeometry::operator+(const ManifoldGeometry& other) const
{
  return binOp(*this, other, manifold::OpType::Add);
}

ManifoldGeometry ManifoldGeometry::operator*(const ManifoldGeometry& other) const
{
  return binOp(*this, other, manifold::OpType::Intersect);
}

ManifoldGeometry ManifoldGeometry::operator-(const ManifoldGeometry& other) const
{
  return binOp(*this, other, manifold::OpType::Subtract);
}

ManifoldGeometry ManifoldGeometry::minkowski(const ManifoldGeometry& other) const
{
#if defined(USE_MANIFOLD_MINKOWSKI)
  auto result = getManifold().MinkowskiSum(other.getManifold());
  std::set<uint32_t> originalIDs;
  auto id = result.OriginalID();
  if (id >= 0) {
    originalIDs.insert(id);
  }
  return {result, originalIDs};
#else
  std::shared_ptr<ManifoldGeometry> geom = minkowskiOp(*this, other);
  if (geom) return *geom;
  else return {};
#endif
}

Polygon2d ManifoldGeometry::slice() const
{
  auto cross_section = manifold::CrossSection(manifold_.Slice());
  return ManifoldUtils::polygonsToPolygon2d(cross_section.ToPolygons());
}

Polygon2d ManifoldGeometry::project() const
{
  auto cross_section = manifold::CrossSection(manifold_.Project());
  return ManifoldUtils::polygonsToPolygon2d(cross_section.ToPolygons());
}

void ManifoldGeometry::transform(const Transform3d& mat)
{
  manifold::mat3x4 glMat(
    // Column-major ordering
    {mat(0, 0), mat(1, 0), mat(2, 0)}, {mat(0, 1), mat(1, 1), mat(2, 1)},
    {mat(0, 2), mat(1, 2), mat(2, 2)}, {mat(0, 3), mat(1, 3), mat(2, 3)});
  manifold_ = getManifold().Transform(glMat);
}

void ManifoldGeometry::setColor(const Color4f& c, float roughness, float metalness, float clearcoat, float clearcoatRoughness, float sheen, const Color4f& sheenColor, float sheenRoughness, float transmission, float thickness, const Color4f& attenuationColor, float attenuationDistance, float ior, const Color4f& emissive, float emissiveIntensity, const Color4f& specularColor, float specularIntensity, float iridescence, float iridescenceIOR, float autoSmoothAngle, std::shared_ptr<const class Value> colormap, std::shared_ptr<const class Value> normalmap)
{
  manifold_ = manifold_.AsOriginal();
  originalIDs_.clear();
  originalIDs_.insert(manifold_.OriginalID());
  originalIDToColor_.clear();
  originalIDToColor_[manifold_.OriginalID()] = c;
  originalIDToRoughness_.clear();
  originalIDToRoughness_[manifold_.OriginalID()] = roughness;
  originalIDToMetalness_.clear();
  originalIDToMetalness_[manifold_.OriginalID()] = metalness;
  originalIDToClearcoat_.clear();
  originalIDToClearcoat_[manifold_.OriginalID()] = clearcoat;
  originalIDToClearcoatRoughness_.clear();
  originalIDToClearcoatRoughness_[manifold_.OriginalID()] = clearcoatRoughness;
  originalIDToSheen_.clear();
  originalIDToSheen_[manifold_.OriginalID()] = sheen;
  originalIDToSheenColor_.clear();
  originalIDToSheenColor_[manifold_.OriginalID()] = sheenColor;
  originalIDToSheenRoughness_.clear();
  originalIDToSheenRoughness_[manifold_.OriginalID()] = sheenRoughness;
  originalIDToTransmission_.clear();
  originalIDToTransmission_[manifold_.OriginalID()] = transmission;
  originalIDToThickness_.clear();
  originalIDToThickness_[manifold_.OriginalID()] = thickness;
  originalIDToAttenuationColor_.clear();
  originalIDToAttenuationColor_[manifold_.OriginalID()] = attenuationColor;
  originalIDToAttenuationDistance_.clear();
  originalIDToAttenuationDistance_[manifold_.OriginalID()] = attenuationDistance;
  originalIDToIOR_.clear();
  originalIDToIOR_[manifold_.OriginalID()] = ior;
  originalIDToEmissive_.clear();
  originalIDToEmissive_[manifold_.OriginalID()] = emissive;
  originalIDToEmissiveIntensity_.clear();
  originalIDToEmissiveIntensity_[manifold_.OriginalID()] = emissiveIntensity;
  originalIDToSpecularColor_.clear();
  originalIDToSpecularColor_[manifold_.OriginalID()] = specularColor;
  originalIDToSpecularIntensity_.clear();
  originalIDToSpecularIntensity_[manifold_.OriginalID()] = specularIntensity;
  originalIDToIridescence_.clear();
  originalIDToIridescence_[manifold_.OriginalID()] = iridescence;
  originalIDToIridescenceIOR_.clear();
  originalIDToIridescenceIOR_[manifold_.OriginalID()] = iridescenceIOR;
  originalIDToAutoSmoothAngle_.clear();
  originalIDToAutoSmoothAngle_[manifold_.OriginalID()] = autoSmoothAngle;
  originalIDToColormap_.clear();
  originalIDToColormap_[manifold_.OriginalID()] = colormap;
  originalIDToNormalmap_.clear();
  originalIDToNormalmap_[manifold_.OriginalID()] = normalmap;
  subtractedIDs_.clear();
}

void ManifoldGeometry::toOriginal()
{
  manifold_ = manifold_.AsOriginal();
  originalIDs_.clear();
  originalIDs_.insert(manifold_.OriginalID());
  originalIDToColor_.clear();
  originalIDToRoughness_.clear();
  originalIDToMetalness_.clear();
  originalIDToClearcoat_.clear();
  originalIDToClearcoatRoughness_.clear();
  originalIDToSheen_.clear();
  originalIDToSheenColor_.clear();
  originalIDToSheenRoughness_.clear();
  originalIDToTransmission_.clear();
  originalIDToThickness_.clear();
  originalIDToAttenuationColor_.clear();
  originalIDToAttenuationDistance_.clear();
  originalIDToIOR_.clear();
  originalIDToEmissive_.clear();
  originalIDToEmissiveIntensity_.clear();
  originalIDToSpecularColor_.clear();
  originalIDToSpecularIntensity_.clear();
  originalIDToIridescence_.clear();
  originalIDToIridescenceIOR_.clear();
  originalIDToAutoSmoothAngle_.clear();
  originalIDToColormap_.clear();
  originalIDToNormalmap_.clear();
  subtractedIDs_.clear();
}

BoundingBox ManifoldGeometry::getBoundingBox() const
{
  BoundingBox result;
  manifold::Box bbox = getManifold().BoundingBox();
  result.extend(vector_convert<Eigen::Vector3d>(bbox.min));
  result.extend(vector_convert<Eigen::Vector3d>(bbox.max));
  return result;
}

void ManifoldGeometry::resize(const Vector3d& newsize, const Eigen::Matrix<bool, 3, 1>& autosize)
{
  transform(GeometryUtils::getResizeTransform(this->getBoundingBox(), newsize, autosize));
}

/*! Iterate over all vertices' points until the function returns true (for done). */
void ManifoldGeometry::foreachVertexUntilTrue(
  const std::function<bool(const manifold::vec3& pt)>& f) const
{
  auto mesh = getManifold().GetMeshGL64();
  const auto numVert = mesh.NumVert();
  for (size_t v = 0; v < numVert; ++v) {
    if (f(mesh.GetVertPos(v))) {
      return;
    }
  }
}
