-- Valeurs impossibles refusées aussi par le serveur (fautes de frappe : −4 °C dans une enceinte positive, signe oublié…).
-- Mêmes bornes que la tablette (app/src/logique.ts). Seulement à l'insertion : l'historique existant n'est pas touché.
create or replace function controler_vraisemblance() returns trigger
language plpgsql set search_path = public as $$
declare t numeric;
begin
  if tg_table_name = 'releves' then
    select e.t_max into t from enceintes e where e.id = new.enceinte_id;
    if t >= 0 and (new.valeur < -3 or new.valeur > 20) then
      raise exception 'Température impossible pour une enceinte positive (entre −3 et +20 °C) : %', new.valeur using errcode = '22023';
    elsif t < 0 and (new.valeur < -40 or new.valeur > 15) then
      raise exception 'Température impossible pour une enceinte négative (entre −40 et +15 °C) : %', new.valeur using errcode = '22023';
    end if;
  elsif tg_table_name = 'huiles' then
    if new.polaires is not null and (new.polaires < 0 or new.polaires > 40) then
      raise exception 'Mesure d''huile impossible (entre 0 et 40 %%) : %', new.polaires using errcode = '22023';
    end if;
  elsif tg_table_name = 'livraisons' then
    if new.t_camion < -30 or new.t_camion > 25 or new.t_frais < -5 or new.t_frais > 25 or new.t_surgele < -40 or new.t_surgele > 5 then
      raise exception 'Température de livraison impossible' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
revoke execute on function controler_vraisemblance() from public, anon, authenticated;
create trigger vraisemblance before insert on releves for each row execute function controler_vraisemblance();
create trigger vraisemblance before insert on huiles for each row execute function controler_vraisemblance();
create trigger vraisemblance before insert on livraisons for each row execute function controler_vraisemblance();
