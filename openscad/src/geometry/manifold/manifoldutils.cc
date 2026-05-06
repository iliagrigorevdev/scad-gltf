// Portions of this file are Copyright 2023 Google LLC, and licensed under GPL2+. See COPYING.
#include "geometry/manifold/manifoldutils.h"

#include <manifold/polygon.h>

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <utility>
#include <vector>
#ifdef ENABLE_CGAL
#include <CGAL/Surface_mesh.h>
#include <CGAL/convex_hull_3.h>
#endif

#include "geometry/Geometry.h"
#include "geometry/PolySet.h"
#include "geometry/PolySetBuilder.h"
#include "geometry/PolySetUtils.h"
#include "geometry/linalg.h"
#include "geometry/manifold/ManifoldGeometry.h"
#include "utils/printutils.h"
#ifdef ENABLE_CGAL
#include "geometry/cgal/cgalutils.h"
#endif

using Error = manifold::Manifold::Error;

namespace {

std::shared_ptr<ManifoldGeometry> createManifoldFromTriangularPolySet(const PolySet& ps)
{
  assert(ps.isTriangular());

  manifold::MeshGL64 mesh;

  mesh.numProp = 3;
  mesh.vertProperties.reserve(ps.vertices.size() * 3);
  for (const auto& v : ps.vertices) {
    mesh.vertProperties.push_back(v.x());
    mesh.vertProperties.push_back(v.y());
    mesh.vertProperties.push_back(v.z());
  }

  mesh.triVerts.reserve(ps.indices.size() * 3);

  std::set<uint32_t> originalIDs;
  std::map<uint32_t, Color4f> originalIDToColor;
  std::map<uint32_t, float> originalIDToRoughness;
  std::map<uint32_t, float> originalIDToMetalness;
  std::map<uint32_t, float> originalIDToClearcoat;
  std::map<uint32_t, float> originalIDToClearcoatRoughness;
  std::map<uint32_t, float> originalIDToSheen;
  std::map<uint32_t, Color4f> originalIDToSheenColor;
  std::map<uint32_t, float> originalIDToSheenRoughness;
  std::map<uint32_t, float> originalIDToTransmission;
  std::map<uint32_t, float> originalIDToThickness;
  std::map<uint32_t, Color4f> originalIDToAttenuationColor;
  std::map<uint32_t, float> originalIDToAttenuationDistance;
  std::map<uint32_t, float> originalIDToIOR;
  std::map<uint32_t, Color4f> originalIDToEmissive;
  std::map<uint32_t, float> originalIDToEmissiveIntensity;
  std::map<uint32_t, Color4f> originalIDToSpecularColor;
  std::map<uint32_t, float> originalIDToSpecularIntensity;
  std::map<uint32_t, float> originalIDToIridescence;
  std::map<uint32_t, float> originalIDToIridescenceIOR;
  std::map<uint32_t, float> originalIDToAnisotropy;
  std::map<uint32_t, float> originalIDToAnisotropyRotation;

  struct MaterialState {
    std::optional<Color4f> color;
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
    float anisotropy;
    float anisotropyRotation;
    bool operator<(const MaterialState& other) const {
      if (color.has_value() != other.color.has_value()) return color.has_value() < other.color.has_value();
      if (color.has_value()) {
        const auto& c1 = color.value();
        const auto& c2 = other.color.value();
        if (c1.r() != c2.r()) return c1.r() < c2.r();
        if (c1.g() != c2.g()) return c1.g() < c2.g();
        if (c1.b() != c2.b()) return c1.b() < c2.b();
        if (c1.a() != c2.a()) return c1.a() < c2.a();
      }
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
      if (anisotropy != other.anisotropy) return anisotropy < other.anisotropy;
      return anisotropyRotation < other.anisotropyRotation;
    }
  };

  std::map<MaterialState, std::vector<size_t>> colorToFaceIndices;
  for (size_t i = 0, n = ps.indices.size(); i < n; i++) {
    auto color_index = i < ps.color_indices.size() ? ps.color_indices[i] : -1;
    std::optional<Color4f> color;
    float roughness = 1.0f;
    float metalness = 0.0f;
    float clearcoat = 0.0f;
    float clearcoatRoughness = 0.0f;
    float sheen = 0.0f;
    Color4f sheenColor;
    Vector4f defSheenColor; defSheenColor[0]=0; defSheenColor[1]=0; defSheenColor[2]=0; defSheenColor[3]=1;
    sheenColor = defSheenColor;
    float sheenRoughness = 0.0f;
    float transmission = 0.0f;
    float thickness = 0.0f;
    Color4f attenuationColor; Vector4f defWhite; defWhite[0]=1; defWhite[1]=1; defWhite[2]=1; defWhite[3]=1; attenuationColor = defWhite;
    float attenuationDistance = 0.0f;
    float ior = 1.5f;
    Color4f emissive; emissive = defSheenColor; // black
    float emissiveIntensity = 1.0f;
    Color4f specularColor; specularColor = defWhite;
    float specularIntensity = 1.0f;
    float iridescence = 0.0f;
    float iridescenceIOR = 1.3f;
    float anisotropy = 0.0f;
    float anisotropyRotation = 0.0f;
    if (color_index >= 0) {
      if (color_index < ps.colors.size()) color = ps.colors[color_index];
      if (color_index < ps.roughnesses.size()) roughness = ps.roughnesses[color_index];
      if (color_index < ps.metalnesses.size()) metalness = ps.metalnesses[color_index];
      if (color_index < ps.clearcoats.size()) clearcoat = ps.clearcoats[color_index];
      if (color_index < ps.clearcoatRoughnesses.size()) clearcoatRoughness = ps.clearcoatRoughnesses[color_index];
      if (color_index < ps.sheens.size()) sheen = ps.sheens[color_index];
      if (color_index < ps.sheenColors.size()) sheenColor = ps.sheenColors[color_index];
      if (color_index < ps.sheenRoughnesses.size()) sheenRoughness = ps.sheenRoughnesses[color_index];
      if (color_index < ps.transmissions.size()) transmission = ps.transmissions[color_index];
      if (color_index < ps.thicknesses.size()) thickness = ps.thicknesses[color_index];
      if (color_index < ps.attenuationColors.size()) attenuationColor = ps.attenuationColors[color_index];
      if (color_index < ps.attenuationDistances.size()) attenuationDistance = ps.attenuationDistances[color_index];
      if (color_index < ps.iors.size()) ior = ps.iors[color_index];
      if (color_index < ps.emissives.size()) emissive = ps.emissives[color_index];
      if (color_index < ps.emissiveIntensities.size()) emissiveIntensity = ps.emissiveIntensities[color_index];
      if (color_index < ps.specularColors.size()) specularColor = ps.specularColors[color_index];
      if (color_index < ps.specularIntensities.size()) specularIntensity = ps.specularIntensities[color_index];
      if (color_index < ps.iridescences.size()) iridescence = ps.iridescences[color_index];
      if (color_index < ps.iridescenceIORs.size()) iridescenceIOR = ps.iridescenceIORs[color_index];
      if (color_index < ps.anisotropies.size()) anisotropy = ps.anisotropies[color_index];
      if (color_index < ps.anisotropyRotations.size()) anisotropyRotation = ps.anisotropyRotations[color_index];
    }
    colorToFaceIndices[{color, roughness, metalness, clearcoat, clearcoatRoughness, sheen, sheenColor, sheenRoughness, transmission, thickness, attenuationColor, attenuationDistance, ior, emissive, emissiveIntensity, specularColor, specularIntensity, iridescence, iridescenceIOR, anisotropy, anisotropyRotation}].push_back(i);
  }
  auto next_id = manifold::Manifold::ReserveIDs(colorToFaceIndices.size());
  for (const auto&[mat, faceIndices] : colorToFaceIndices) {
    auto id = next_id++;
    if (mat.color.has_value()) {
      originalIDToColor[id] = mat.color.value();
      originalIDToRoughness[id] = mat.roughness;
      originalIDToMetalness[id] = mat.metalness;
      originalIDToClearcoat[id] = mat.clearcoat;
      originalIDToClearcoatRoughness[id] = mat.clearcoatRoughness;
      originalIDToSheen[id] = mat.sheen;
      originalIDToSheenColor[id] = mat.sheenColor;
      originalIDToSheenRoughness[id] = mat.sheenRoughness;
      originalIDToTransmission[id] = mat.transmission;
      originalIDToThickness[id] = mat.thickness;
      originalIDToAttenuationColor[id] = mat.attenuationColor;
      originalIDToAttenuationDistance[id] = mat.attenuationDistance;
      originalIDToIOR[id] = mat.ior;
      originalIDToEmissive[id] = mat.emissive;
      originalIDToEmissiveIntensity[id] = mat.emissiveIntensity;
      originalIDToSpecularColor[id] = mat.specularColor;
      originalIDToSpecularIntensity[id] = mat.specularIntensity;
      originalIDToIridescence[id] = mat.iridescence;
      originalIDToIridescenceIOR[id] = mat.iridescenceIOR;
      originalIDToAnisotropy[id] = mat.anisotropy;
      originalIDToAnisotropyRotation[id] = mat.anisotropyRotation;
    }

    mesh.runIndex.push_back(mesh.triVerts.size());
    mesh.runOriginalID.push_back(id);
    originalIDs.insert(id);

    for (size_t faceIndex : faceIndices) {
      auto& face = ps.indices[faceIndex];
      assert(face.size() == 3);
      mesh.triVerts.push_back(face[0]);
      mesh.triVerts.push_back(face[1]);
      mesh.triVerts.push_back(face[2]);
    }
  }
  mesh.runIndex.push_back(mesh.triVerts.size());

  auto mani = manifold::Manifold(mesh);

  if (mani.Status() != Error::NoError) {
    PRINTD("Manifold creation initially failed");
    bool merged = mesh.Merge();
    mani = manifold::Manifold(mesh);
    if (mani.Status() == Error::NoError && merged) {
      PRINTD("..succeeded after merge");
    } else if (mani.Status() != Error::NoError && merged) {
      PRINTD("..still failing after merge");
    } else if (mani.Status() != Error::NoError && !merged) {
      PRINTD("..unable to merge");
    } else if (mani.Status() == Error::NoError && !merged) {
      PRINTD("..unable to merge, but somehow succeeded anyway?");
    }
  }

  return std::make_shared<ManifoldGeometry>(mani, originalIDs, originalIDToColor, originalIDToRoughness, originalIDToMetalness, originalIDToClearcoat, originalIDToClearcoatRoughness, originalIDToSheen, originalIDToSheenColor, originalIDToSheenRoughness, originalIDToTransmission, originalIDToThickness, originalIDToAttenuationColor, originalIDToAttenuationDistance, originalIDToIOR, originalIDToEmissive, originalIDToEmissiveIntensity, originalIDToSpecularColor, originalIDToSpecularIntensity, originalIDToIridescence, originalIDToIridescenceIOR, originalIDToAnisotropy, originalIDToAnisotropyRotation);
}

}  // namespace

namespace ManifoldUtils {

const char *statusToString(Error status)
{
  switch (status) {
  case Error::NoError:                      return "NoError";
  case Error::NonFiniteVertex:              return "NonFiniteVertex";
  case Error::NotManifold:                  return "NotManifold";
  case Error::VertexOutOfBounds:            return "VertexOutOfBounds";
  case Error::PropertiesWrongLength:        return "PropertiesWrongLength";
  case Error::MissingPositionProperties:    return "MissingPositionProperties";
  case Error::MergeVectorsDifferentLengths: return "MergeVectorsDifferentLengths";
  case Error::MergeIndexOutOfBounds:        return "MergeIndexOutOfBounds";
  case Error::TransformWrongLength:         return "TransformWrongLength";
  case Error::RunIndexWrongLength:          return "RunIndexWrongLength";
  case Error::FaceIDWrongLength:            return "FaceIDWrongLength";
  default:                                  return "unknown";
  }
}

std::shared_ptr<ManifoldGeometry> createManifoldFromPolySet(const PolySet& ps)
{
  // 1. If the PolySet is already manifold, we should be able to build a Manifold object directly
  // (through using manifold::Mesh).
  // We need to make sure our PolySet is triangulated before doing that.
  // Note: We currently don't have a way of directly checking if a PolySet is manifold,
  // so we just try converting to a Manifold object and check its status.
  std::unique_ptr<const PolySet> triangulated;
  if (!ps.isTriangular()) {
    triangulated = PolySetUtils::tessellate_faces(ps);
  }
  const PolySet& triangle_set = ps.isTriangular() ? ps : *triangulated;

  // Note: This function also performs a merge if the first attempt fails.
  auto mani = createManifoldFromTriangularPolySet(triangle_set);
  if (mani->getManifold().Status() == Error::NoError) {
    return mani;
  }

  LOG(message_group::Warning,
      "PolySet -> Manifold conversion failed: %1$s\n"
      "Trying to repair and reconstruct mesh..",
      ManifoldUtils::statusToString(mani->getManifold().Status()));

  // 2. If the PolySet couldn't be converted into a Manifold object, let's try to repair it.
  // We currently have to utilize some CGAL functions to do this.
#ifdef ENABLE_CGAL
  try {
    PolySet psq(ps);
    std::vector<Vector3d> points3d;
    psq.quantizeVertices(&points3d);
    auto ps_tri = PolySetUtils::tessellate_faces(psq);

    CGAL_DoubleMesh m;

    if (ps_tri->isConvex()) {
      using K = CGAL::Epick;
      // Collect point cloud
      std::vector<K::Point_3> points(points3d.size());
      for (size_t i = 0, n = points3d.size(); i < n; i++) {
        points[i] = CGALUtils::vector_convert<K::Point_3>(points3d[i]);
      }
      if (points.size() <= 3) return std::make_shared<ManifoldGeometry>();

      // Apply hull
      CGAL::Surface_mesh<CGAL::Point_3<K>> r;
      CGAL::convex_hull_3(points.begin(), points.end(), r);
      CGALUtils::copyMesh(r, m);
    } else {
      m = CGALUtils::repairPolySet(*ps_tri);
    }

    if (!ps_tri->isConvex()) {
      if (CGALUtils::isClosed(m)) {
        CGALUtils::orientToBoundAVolume(m);
      } else {
        LOG(message_group::Error, "[manifold] Input mesh is not closed!");
      }
    }

    auto geom = createManifoldFromSurfaceMesh(m);
    // TODO: preserve color if polyset is fully monochrome, or maybe pass colors around in surface mesh?
    return geom;
  } catch (const std::exception& e) {
    LOG(message_group::Error, "[manifold] CGAL error: %1$s", e.what());
  }
#endif
  return std::make_shared<ManifoldGeometry>();
}

std::shared_ptr<const ManifoldGeometry> createManifoldFromGeometry(
  const std::shared_ptr<const Geometry>& geom)
{
  if (auto mani = std::dynamic_pointer_cast<const ManifoldGeometry>(geom)) {
    return mani;
  }
  if (auto ps = PolySetUtils::getGeometryAsPolySet(geom)) {
    return createManifoldFromPolySet(*ps);
  }
  return nullptr;
}

Polygon2d polygonsToPolygon2d(const manifold::Polygons& polygons)
{
  Polygon2d poly2d;
  for (const auto& polygon : polygons) {
    Outline2d outline;
    for (const auto& v : polygon) {
      outline.vertices.emplace_back(v[0], v[1]);
    }
    poly2d.addOutline(std::move(outline));
  }
  return poly2d;
}

std::unique_ptr<PolySet> createTriangulatedPolySetFromPolygon2d(const Polygon2d& polygon2d)
{
  auto polyset = std::make_unique<PolySet>(2);
  polyset->setTriangular(true);

  manifold::Polygons polygons;
  for (const auto& outline : polygon2d.outlines()) {
    manifold::SimplePolygon simplePolygon;
    for (const auto& vertex : outline.vertices) {
      polyset->vertices.emplace_back(vertex[0], vertex[1], 0.0);
      simplePolygon.emplace_back(vertex[0], vertex[1]);
    }
    polygons.push_back(std::move(simplePolygon));
  }

  const auto triangles = manifold::Triangulate(polygons);

  for (const auto& triangle : triangles) {
    polyset->indices.push_back({triangle[0], triangle[1], triangle[2]});
  }
  return polyset;
}

template <class SurfaceMesh>
std::shared_ptr<ManifoldGeometry> createManifoldFromSurfaceMesh(const SurfaceMesh& tm)
{
  using vertex_descriptor = typename SurfaceMesh::Vertex_index;

  manifold::MeshGL64 meshgl;

  meshgl.numProp = 3;
  meshgl.vertProperties.resize(tm.number_of_vertices() * 3);
  for (vertex_descriptor vd : tm.vertices()) {
    const auto& v = tm.point(vd);
    meshgl.vertProperties[3 * vd] = v.x();
    meshgl.vertProperties[3 * vd + 1] = v.y();
    meshgl.vertProperties[3 * vd + 2] = v.z();
  }

  meshgl.triVerts.reserve(tm.number_of_faces() * 3);
  for (const auto& f : tm.faces()) {
    size_t idx[3];
    size_t i = 0;
    for (vertex_descriptor vd : vertices_around_face(tm.halfedge(f), tm)) {
      if (i >= 3) break;
      idx[i++] = vd;
    }
    if (i < 3) continue;
    for (size_t j : {0, 1, 2}) meshgl.triVerts.emplace_back(idx[j]);
  }

  assert((meshgl.triVerts.size() == tm.number_of_faces() * 3) || !"Mesh was not triangular!");

  auto mani = manifold::Manifold(meshgl).AsOriginal();
  if (mani.Status() != Error::NoError) {
    LOG(message_group::Error, "[manifold] Surface_mesh -> Manifold conversion failed: %1$s",
        ManifoldUtils::statusToString(mani.Status()));
    return nullptr;
  }
  std::set<uint32_t> originalIDs;
  auto id = mani.OriginalID();
  if (id >= 0) {
    originalIDs.insert(id);
  }
  return std::make_shared<ManifoldGeometry>(mani, originalIDs);
}

template <class SurfaceMesh>
std::shared_ptr<SurfaceMesh> createSurfaceMeshFromManifold(const manifold::Manifold& mani)
{
  const auto meshgl = mani.GetMeshGL64();
  auto mesh = std::make_shared<SurfaceMesh>();
  mesh->reserve(meshgl.NumVert(), meshgl.NumTri() * 3, meshgl.NumTri());
  for (size_t i = 0; i < meshgl.NumVert(); i++) {
    const auto& v = meshgl.GetVertPos(i);
    mesh->add_vertex(typename SurfaceMesh::Point(v[0], v[1], v[2]));
  }
  for (size_t i = 0; i < meshgl.NumTri(); i++) {
    const auto& tri = meshgl.GetTriVerts(i);
    mesh->add_face(typename SurfaceMesh::Vertex_index(tri[0]),
                   typename SurfaceMesh::Vertex_index(tri[1]),
                   typename SurfaceMesh::Vertex_index(tri[2]));
  }
  return mesh;
}

#ifdef ENABLE_CGAL
template std::shared_ptr<ManifoldGeometry> createManifoldFromSurfaceMesh(
  const CGAL::Surface_mesh<CGAL::Point_3<CGAL::Epick>>& tm);
template std::shared_ptr<ManifoldGeometry> createManifoldFromSurfaceMesh(const CGAL_DoubleMesh& tm);
template std::shared_ptr<CGAL::Surface_mesh<manifold::vec3>>
createSurfaceMeshFromManifold<CGAL::Surface_mesh<manifold::vec3>>(const manifold::Manifold& mani);
template std::shared_ptr<CGAL::Surface_mesh<CGAL_Point_3>>
createSurfaceMeshFromManifold<CGAL::Surface_mesh<CGAL_Point_3>>(const manifold::Manifold& mani);
#endif

};  // namespace ManifoldUtils
