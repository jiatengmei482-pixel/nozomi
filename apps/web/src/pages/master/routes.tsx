/** 运营后台主数据的路由（地址见 lib/master-paths.ts）：每类是「列表 / new / :id」，另有「处理导入的机场」。 */
import { Route } from "react-router";
import { PENDING_AIRPORTS_PATH, masterListPath, masterNewPath } from "../../lib/master-paths.ts";
import { cityFormModel } from "./CityForm.tsx";
import { MasterFormPage } from "./MasterForm.tsx";
import { addonFormModel, vehicleGroupFormModel } from "./OtherForms.tsx";
import { PendingAirportsPage } from "./PendingAirportsPage.tsx";
import { placeFormModel } from "./PlaceForm.tsx";
import { AddonListPage, CityListPage, PlaceListPage, VehicleGroupListPage } from "./lists.tsx";

export function masterRoutes() {
  return (
    <>
      <Route path={masterListPath("cities")} element={<CityListPage />} />
      <Route path={masterNewPath("cities")} element={<MasterFormPage key="city-new" model={cityFormModel} />} />
      <Route path={`${masterListPath("cities")}/:id`} element={<MasterFormPage key="city-edit" model={cityFormModel} />} />
      <Route path={masterListPath("places")} element={<PlaceListPage />} />
      <Route path={PENDING_AIRPORTS_PATH} element={<PendingAirportsPage />} />
      <Route path={masterNewPath("places")} element={<MasterFormPage key="place-new" model={placeFormModel} />} />
      <Route path={`${masterListPath("places")}/:id`} element={<MasterFormPage key="place-edit" model={placeFormModel} />} />
      <Route path={masterListPath("vehicle-groups")} element={<VehicleGroupListPage />} />
      <Route path={masterNewPath("vehicle-groups")} element={<MasterFormPage key="group-new" model={vehicleGroupFormModel} />} />
      <Route path={`${masterListPath("vehicle-groups")}/:id`} element={<MasterFormPage key="group-edit" model={vehicleGroupFormModel} />} />
      <Route path={masterListPath("addons")} element={<AddonListPage />} />
      <Route path={masterNewPath("addons")} element={<MasterFormPage key="addon-new" model={addonFormModel} />} />
      <Route path={`${masterListPath("addons")}/:id`} element={<MasterFormPage key="addon-edit" model={addonFormModel} />} />
    </>
  );
}
